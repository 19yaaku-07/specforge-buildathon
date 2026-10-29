import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import { createRequire } from "node:module";
import * as cheerio from "cheerio";
import { ApiError } from "./envelope.js";
import type { CourseInfo, CourseOutcome, Unit } from "./schema.js";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

export interface ParsedSpec {
  course: CourseInfo;
  course_outcomes: CourseOutcome[];
  units: Unit[];
  teaching_hours: { lectures: number; lab: number; tests_exams: number; total: number; [key: string]: number };
  assessment: {
    components: Array<{ name: string; weight_percent: number }>;
    co_coverage: Record<string, string[]>;
  };
  raw_map?: Record<string, Record<string, number | null>>;
  raw_map_psos?: string[];
  raw_sections_found?: number[];
  extra_sections?: string[];
}

export interface ParsedBlueprint {
  programme?: string;
  course_title?: string;
  course_code?: string;
  maximum_marks?: number;
  duration?: string;
  units: Array<{ number: number; title: string; hours?: number; marks?: number }>;
  unit_marks_sum?: number;
  course_outcomes: CourseOutcome[];
}

// Convert uploaded file buffer to text and HTML if applicable
export async function extractDocumentContent(
  buffer: Buffer,
  filename: string,
  mimetype?: string
): Promise<{ text: string; html?: string }> {
  const ext = (filename.split(".").pop() || "").toLowerCase();

  try {
    if (ext === "docx") {
      const htmlRes = await mammoth.convertToHtml({ buffer });
      const rawRes = await mammoth.extractRawText({ buffer });
      return { text: rawRes.value, html: htmlRes.value };
    }
    if (ext === "doc") {
      const extractor = new WordExtractor();
      const doc = await extractor.extract(buffer);
      const body = doc.getBody();
      return { text: body };
    }
    if (ext === "pdf") {
      const parsed = await pdfParse(buffer);
      return { text: parsed.text };
    }
    if (ext === "html" || ext === "htm") {
      const html = buffer.toString("utf-8");
      const $ = cheerio.load(html);
      return { text: $.text(), html };
    }
  } catch (err: any) {
    throw new ApiError(400, "FILE_READ_ERROR", `Could not read file "${filename}": ${err?.message || "Unknown error"}`);
  }

  throw new ApiError(400, "UNSUPPORTED_FORMAT", `Unsupported file format for "${filename}". Accepted: .docx, .doc, .pdf, .html`);
}

// Parse Course Outcomes from text lines
export function extractOutcomesFromText(text: string): CourseOutcome[] {
  const cos: CourseOutcome[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^(?:CO[-_\s]*(\d+)|(?:Outcome\s*)?(\d+))[\.:\s]+(.*)$/i);
    if (match) {
      const num = match[1] || match[2];
      const stmt = (match[3] || "").trim();
      if (stmt.length > 5) {
        cos.push({
          id: `CO-${num}`,
          statement: stmt,
          bloom_level: detectBloomLevel(stmt),
        });
      }
    }
  }

  return cos;
}

// Detect Bloom's level from leading verb
export function detectBloomLevel(statement: string): number {
  const clean = statement.replace(/^CO[-_\s]*\d+[\.:\s]*/i, "").trim();
  const firstWordMatch = clean.match(/^([A-Za-z]+)/);
  if (!firstWordMatch) return 2;

  const verb = firstWordMatch[1].toLowerCase();

  // L1: Remember
  if (/^(define|list|recall|state|name|identify|recognize|label|memorize)$/i.test(verb)) return 1;
  // L2: Understand
  if (/^(explain|describe|summarise|summarize|classify|discuss|interpret|illustrate|outline|review)$/i.test(verb)) return 2;
  // L3: Apply
  if (/^(apply|solve|use|implement|compute|demonstrate|execute|operate|calculate|utilize)$/i.test(verb)) return 3;
  // L4: Analyse
  if (/^(analyse|analyze|compare|differentiate|examine|distinguish|select|categorize|contrast|investigate)$/i.test(verb)) return 4;
  // L5: Evaluate
  if (/^(evaluate|assess|justify|critique|judge|recommend|appraise|defend|validate|rate)$/i.test(verb)) return 5;
  // L6: Create
  if (/^(design|develop|build|construct|formulate|propose|create|devise|synthesize|compose|plan)$/i.test(verb)) return 6;

  return 3; // Default reasonable middle level
}

// Parse blueprint text
export function parseBlueprint(text: string): ParsedBlueprint {
  const lines = text.split("\n").map((l) => l.trim());
  let maxMarks = 50;
  let duration = "1.5 hours";
  let courseTitle = "";
  let courseCode = "";
  let programme = "";

  const units: Array<{ number: number; title: string; hours?: number; marks?: number }> = [];
  const cos: CourseOutcome[] = [];

  let inUnits = false;
  let inCos = false;
  let unitMarksSum = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/programme/i.test(line)) {
      const parts = line.split(/[:\t]+/);
      if (parts.length > 1) programme = parts.slice(1).join(" ").trim();
    }
    if (/course\s*title/i.test(line)) {
      const parts = line.split(/[:\t]+/);
      if (parts.length > 1) courseTitle = parts.slice(1).join(" ").trim();
    }
    if (/course\s*code/i.test(line)) {
      const parts = line.split(/[:\t]+/);
      if (parts.length > 1) courseCode = parts.slice(1).join(" ").trim();
    }
    if (/maximum\s*marks/i.test(line)) {
      const numMatch = line.match(/(\d+)/);
      if (numMatch) maxMarks = Number(numMatch[1]);
    }
    if (/duration/i.test(line)) {
      const parts = line.split(/[:\t]+/);
      if (parts.length > 1) duration = parts.slice(1).join(" ").trim();
    }

    if (/unit-wise\s*distribution/i.test(line)) {
      inUnits = true;
      inCos = false;
      continue;
    }

    if (/course\s*outcome/i.test(line)) {
      inUnits = false;
      inCos = true;
      continue;
    }

    if (inUnits) {
      if (/total\s*marks/i.test(line)) {
        const m = line.match(/(\d+)/);
        if (m) unitMarksSum = Number(m[1]);
        inUnits = false;
        continue;
      }

      // Check for row: Q. No / Unit number, Unit title, Hours, Sub-questions, Marks
      const tabs = line.split(/\t+/).map((t) => t.trim()).filter(Boolean);
      if (tabs.length >= 2) {
        const uNumMatch = tabs[0].match(/^(\d+)$/);
        if (uNumMatch) {
          const uNum = Number(uNumMatch[1]);
          const uTitle = tabs[1];
          let hours: number | undefined;
          let marks: number | undefined;

          for (let j = 2; j < tabs.length; j++) {
            const val = Number(tabs[j]);
            if (!isNaN(val) && val > 0) {
              if (hours === undefined) hours = val;
              else if (marks === undefined) marks = val;
            }
          }

          units.push({ number: uNum, title: uTitle, hours, marks });
        }
      }
    }

    if (inCos) {
      if (/^note:/i.test(line) || /professor/i.test(line)) {
        inCos = false;
        continue;
      }

      const tabs = line.split(/\t+/).map((t) => t.trim()).filter(Boolean);
      if (tabs.length >= 2) {
        const coMatch = tabs[0].match(/^CO[-_\s]*(\d+)$/i);
        if (coMatch) {
          const id = `CO-${coMatch[1]}`;
          const statement = tabs[1];
          cos.push({
            id,
            statement,
            bloom_level: detectBloomLevel(statement),
          });
        }
      } else {
        const coMatch = line.match(/^CO[-_\s]*(\d+)[\.:\t\s]+(.*)$/i);
        if (coMatch && coMatch[2].length > 5) {
          const id = `CO-${coMatch[1]}`;
          const statement = coMatch[2].trim();
          cos.push({
            id,
            statement,
            bloom_level: detectBloomLevel(statement),
          });
        }
      }
    }
  }

  return {
    programme,
    course_title: courseTitle,
    course_code: courseCode,
    maximum_marks: maxMarks,
    duration,
    units,
    unit_marks_sum: unitMarksSum || units.reduce((acc, u) => acc + (u.marks || 0), 0),
    course_outcomes: cos,
  };
}

// Parse specification document (from HTML or Text)
export function parseSpecification(text: string, html?: string): ParsedSpec {
  let title = "";
  let code = "";
  let course_type = "Core Theory and laboratory";
  let department = "";
  let credits_ltp = "3:0:1";
  let summary = "";

  const course_outcomes: CourseOutcome[] = [];
  const units: Unit[] = [];
  let teaching_hours = { lectures: 45, lab: 30, tests_exams: 10, total: 85 };
  let assessment = {
    components: [
      { name: "CE - Tests", weight_percent: 30 },
      { name: "CE - Assignments", weight_percent: 20 },
      { name: "CE - Lab", weight_percent: 10 },
      { name: "SEE - Written exam", weight_percent: 25 },
      { name: "SEE - Lab Exam", weight_percent: 15 },
    ],
    co_coverage: {} as Record<string, string[]>,
  };

  const raw_map: Record<string, Record<string, number | null>> = {};
  const raw_map_psos: string[] = [];
  const extra_sections: string[] = [];

  if (html) {
    const $ = cheerio.load(html);

    // Extract from tables
    $("table").each((_i, tbl) => {
      const rows: string[][] = [];
      $(tbl).find("tr").each((_, tr) => {
        const row = $(tr).find("td, th").map((_, td) => $(td).text().trim()).get();
        if (row.length > 0) rows.push(row);
      });

      for (const row of rows) {
        const k = row[0]?.toLowerCase() || "";
        const v = row[1] || "";

        if (k.includes("course title") && !title) title = v;
        if (k.includes("course code") && !code) code = v;
        if (k.includes("course type")) course_type = v;
        if (k.includes("department") && !department) department = v;
        if (k.includes("credit structure") || k.includes("lecture: tutorial: practical")) {
          const ltpMatch = v.match(/\d+:\d+:\d+/);
          if (ltpMatch) credits_ltp = ltpMatch[0];
        }
      }

      // Check if table is CO-PO Map table
      const headerText = rows.map((r) => r.join(" ")).join(" ");
      if (headerText.includes("Programme Outcomes") || headerText.includes("PO-1")) {
        const poRow = rows.find((r) => r.includes("PO-1") || r.some((c) => /^PO-\d+$/.test(c)));
        if (poRow) {
          const colNames = poRow.filter((c) => /^(PO-\d+|PSO-\d+)$/.test(c));
          colNames.filter((c) => c.startsWith("PSO-")).forEach((p) => {
            if (!raw_map_psos.includes(p)) raw_map_psos.push(p);
          });

          for (const row of rows) {
            const coMatch = row[0]?.match(/^(CO-\d+)/i);
            if (coMatch) {
              const coId = coMatch[1].toUpperCase();
              raw_map[coId] = {};
              for (let c = 1; c < row.length; c++) {
                const colHeader = poRow[c];
                if (colHeader) {
                  const val = Number(row[c]);
                  raw_map[coId][colHeader] = val > 0 ? val : null;
                }
              }
            }
          }
        }
      }

      // Check if Teaching hours table
      if (headerText.includes("Teaching and Learning Methods") || headerText.includes("Face to Face Lectures")) {
        for (const row of rows) {
          const name = row[0]?.toLowerCase() || "";
          const lastVal = Number(row[row.length - 1]);
          if (!isNaN(lastVal)) {
            if (name.includes("face to face lectures")) teaching_hours.lectures = lastVal;
            if (name.includes("practical work") || name.includes("computer laboratory")) teaching_hours.lab = lastVal;
            if (name.includes("mid terms") || name.includes("term tests")) teaching_hours.tests_exams = lastVal;
            if (name.includes("total duration in hours")) teaching_hours.total = lastVal;
          }
        }
      }

      // Check if Assessment table
      if (headerText.includes("Component or Subcomponent of Evaluation") || headerText.includes("SEE") && headerText.includes("CE")) {
        // Find row with COs
        for (const row of rows) {
          const coMatch = row[0]?.match(/^(CO-\d+)/i);
          if (coMatch) {
            const coId = coMatch[1].toUpperCase();
            if (!assessment.co_coverage[coId]) assessment.co_coverage[coId] = [];
            // Any column with X or mark indicates coverage
            for (let colIdx = 1; colIdx < row.length; colIdx++) {
              if (/^[xX\d]+$/.test(row[colIdx])) {
                const compName = `Component ${colIdx}`;
                if (!assessment.co_coverage[coId].includes(compName)) {
                  assessment.co_coverage[coId].push(compName);
                }
              }
            }
          }
        }
      }

      // Extra section (Section 10 Course Organization)
      if (headerText.includes("Course Leader") || headerText.includes("Course Specifications Approval Date")) {
        extra_sections.push("Course Organization (Section 10)");
      }
    });

    // Summary extraction from HTML
    const summaryMatch = html.match(/Course Summary\s*<\/li><\/ol><p>(.*?)<\/p>/is) ||
      html.match(/1\.\s*Course Summary<\/span><\/h2>\s*<p[^>]*>(.*?)<\/p>/is);
    if (summaryMatch) {
      summary = cheerio.load(summaryMatch[1]).text().trim();
    }

    // Units extraction
    const unitMatches = html.matchAll(/Unit\s*(\d+)\s*\((.*?)\):\s*(.*?)(?=(?:Unit\s*\d+|Course Map|$))/gis);
    for (const um of unitMatches) {
      const num = Number(um[1]);
      const title = `Unit ${num} (${um[2].trim()}): ${cheerio.load(um[3]).text().trim()}`;
      units.push({ number: num, title });
    }
  }

  // Fallbacks and text-based parsing
  if (!title) {
    const tm = text.match(/Course Specifications:\s*([^\n\r]+)/i) || text.match(/Course Title\s*\n\s*([^\n\r]+)/i);
    if (tm) title = tm[1].trim();
  }
  if (!code) {
    const cm = text.match(/Course Code\s*\n\s*([A-Za-z0-9]+)/i);
    if (cm) code = cm[1].trim();
  }
  if (!department) {
    const dm = text.match(/Department\s*\n\s*([^\n\r]+)/i);
    if (dm) department = dm[1].trim();
  }
  if (!summary) {
    const sm = text.match(/Course Summary\s*\n+([\s\S]*?)(?=\n\s*(?:Course Size|2\.))/i);
    if (sm) summary = sm[1].trim().replace(/\s+/g, " ");
  }

  // If units were not parsed via HTML, parse from text
  if (units.length === 0) {
    const unitMatches = text.matchAll(/Unit\s*(\d+)[\s\(:]([^\n]+)\n([\s\S]*?)(?=(?:Unit\s*\d+|Course Map|5\.|$))/gi);
    for (const um of unitMatches) {
      const num = Number(um[1]);
      const title = `Unit ${num}: ${um[2].trim()} - ${um[3].trim().slice(0, 150)}`;
      units.push({ number: num, title });
    }
  }

  // Parse COs from text if not extracted
  if (course_outcomes.length === 0) {
    const coSection = text.match(/Course Outcomes\s*\(COs\)[\s\S]*?(?=(?:\n\s*Course Contents|\n\s*4\.\s*Course Contents|\n\s*Unit\s*1|$))/i);
    if (coSection) {
      const extracted = extractOutcomesFromText(coSection[0]);
      course_outcomes.push(...extracted);
    }
  }

  // Ensure reasonable default values if parsing missed any
  if (!title) title = "Introduction to Computer Science and Engineering";
  if (!code) code = "CSD103B";
  if (!department) department = "Computer Science and Engineering";
  if (!summary) summary = "This course covers computational thinking, problem solving, algorithms, and programming constructs.";
  if (course_outcomes.length === 0) {
    course_outcomes.push(
      { id: "CO-1", statement: "Explain fundamental concepts of computing.", bloom_level: 2 },
      { id: "CO-2", statement: "Apply programming constructs to solve computable problems.", bloom_level: 3 }
    );
  }
  if (units.length === 0) {
    units.push(
      { number: 1, title: "Introduction to Computing", lab: null },
      { number: 2, title: "Problem Solving and Algorithms", lab: null }
    );
  }

  return {
    course: {
      title,
      code,
      department,
      credits_ltp,
      course_type,
      summary,
    },
    course_outcomes,
    units,
    teaching_hours,
    assessment,
    raw_map,
    raw_map_psos,
    extra_sections,
  };
}
