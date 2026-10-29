import { readFileSync } from "node:fs";
import * as cheerio from "cheerio";
import type { CourseInfo, CourseOutcome, Unit } from "./schema.js";
import type { MapResult } from "./mapper.js";

export function selectTemplate(course: CourseInfo): "integrated" | "non_lab" {
  const ltp = course.credits_ltp.split(":").map((n) => Number(n.trim()));
  const practicalCredits = ltp.length === 3 ? ltp[2] : 0;
  const isLabType = /lab|practical/i.test(course.course_type);

  if (practicalCredits > 0 || isLabType) {
    return "integrated";
  }
  return "non_lab";
}

export function generateSpecHtml(
  templateName: "integrated" | "non_lab",
  course: CourseInfo,
  cos: CourseOutcome[],
  units: Unit[],
  map: MapResult,
  teachingHours: { lectures: number; lab: number; tests_exams: number; total: number; [key: string]: number },
  assessment: { components: Array<{ name: string; weight_percent: number }>; co_coverage: Record<string, string[]> }
): string {
  const templatePath = templateName === "integrated" ? "templates/integrated_lab.html" : "templates/non_lab.html";
  const rawHtml = readFileSync(templatePath, "utf-8");
  const $ = cheerio.load(rawHtml);

  // 1. Update Title Header
  $("h1 span[contenteditable='true']").text(course.title);
  $("title").text(`Course Specifications - ${course.code}: ${course.title}`);

  // Table 0 (Course Details)
  const headerTbl = $("table").first();
  headerTbl.find("tr").each((_, tr) => {
    const label = $(tr).find("td.static").text().trim().toLowerCase();
    const valTd = $(tr).find("td[contenteditable='true']");
    if (label.includes("course title")) valTd.text(course.title);
    if (label.includes("course code")) valTd.text(course.code);
    if (label.includes("course type")) valTd.text(course.course_type);
    if (label.includes("department")) valTd.text(course.department);
  });

  // 2. Section 1 (Course Summary)
  // Find h2 for Course Summary
  $("h2").each((_, h2) => {
    const text = $(h2).text();
    if (text.includes("1. Course Summary") || text.includes("Course Summary")) {
      const p = $(h2).next("p[contenteditable='true']");
      if (p.length) p.text(course.summary);
    }
  });

  // 3. Section 2 (Course Size and Credits)
  $("h2").each((_, h2) => {
    const text = $(h2).text();
    if (text.includes("2. Course Size") || text.includes("Course Size and Credits")) {
      const tbl = $(h2).nextAll("table").first();
      tbl.find("tr").each((_, tr) => {
        const label = $(tr).find("td.static").text().trim().toLowerCase();
        const valTd = $(tr).find("td[contenteditable='true']");
        if (label.includes("credit structure") || label.includes("lecture: tutorial: practical")) {
          valTd.text(course.credits_ltp);
        }
        if (label.includes("department responsible")) {
          valTd.text(course.department);
        }
      });
    }
  });

  // 4. Section 3 (Course Outcomes)
  const coUl = $("ul.co-list");
  if (coUl.length) {
    coUl.empty();
    for (const co of cos) {
      coUl.append(`<li>${co.statement}</li>\n`);
    }
  }

  // 5. Section 4 (Course Contents)
  // Replace unit-rows
  let sec4H2 = $("h2").filter((_, el) => $(el).text().includes("4. Course Contents") || $(el).text().includes("Course Contents"));
  if (sec4H2.length) {
    // Remove old unit rows
    $(".unit-row").remove();
    let insertAfterTarget = sec4H2;
    for (const u of units) {
      const labSnippet = u.lab ? `<br><em>Lab Exercises:</em> ${u.lab}` : "";
      const unitEl = $(`
<div class="unit-row">
<span class="static unit-label" style="padding: 1px 3px; border-radius: 2px;">Unit ${u.number}:</span> <span contenteditable="true">${u.title}${labSnippet}</span>
</div>`);
      insertAfterTarget.after(unitEl);
      insertAfterTarget = unitEl;
    }
  }

  // 6. Section 5 (Course Map CO-PO-PSO Map)
  const copoTable = $("table.copo-table");
  if (copoTable.length) {
    const tbody = copoTable.find("tbody");
    tbody.empty();

    const poCols = ["PO-1", "PO-2", "PO-3", "PO-4", "PO-5", "PO-6", "PO-7", "PO-8", "PO-9", "PO-10", "PO-11"];
    const psoCols = ["PSO-1", "PSO-2"];

    for (const co of cos) {
      const coMap = map[co.id] || {};
      let rowHtml = `<tr>\n<td class="text-center" contenteditable="true" style="font-weight:bold;">${co.id}</td>\n`;

      for (const po of poCols) {
        const cell = coMap[po];
        const val = cell && cell.level ? String(cell.level) : "";
        const titleAttr = cell && cell.justification ? ` title="${cell.justification.replace(/"/g, '&quot;')}"` : "";
        rowHtml += `<td class="text-center" contenteditable="true"${titleAttr}>${val}</td>\n`;
      }

      for (const pso of psoCols) {
        const cell = coMap[pso];
        const val = cell && cell.level ? String(cell.level) : "";
        const titleAttr = cell && cell.justification ? ` title="${cell.justification.replace(/"/g, '&quot;')}"` : "";
        rowHtml += `<td class="text-center" contenteditable="true"${titleAttr}>${val}</td>\n`;
      }

      rowHtml += `</tr>\n`;
      tbody.append(rowHtml);
    }

    tbody.append(`
<tr class="copo-legend-row">
    <td class="static text-center" colspan="14"><strong>3: Very Strong Contribution, 2: Strong Contribution, 1: Moderate Contribution</strong></td>
</tr>`);
  }

  // 7. Section 7 (Assessment Table)
  const assessTable = $("table.assessment-integrated-table");
  if (assessTable.length) {
    const tbody = assessTable.find("tbody");
    tbody.empty();

    for (const co of cos) {
      const covered = assessment.co_coverage[co.id] || [];
      const hasCoverage = covered.length > 0;

      if (templateName === "integrated") {
        tbody.append(`
<tr>
<td class="static text-center" style="font-weight: bold;">${co.id}</td>
<td class="text-center" contenteditable="true">${hasCoverage ? "X" : ""}</td>
<td class="text-center" contenteditable="true">${hasCoverage && co.bloom_level >= 3 ? "X" : ""}</td>
<td class="text-center" contenteditable="true">${hasCoverage && co.bloom_level >= 3 ? "X" : ""}</td>
<td class="text-center" contenteditable="true">${course.credits_ltp.endsWith(":1") && co.bloom_level >= 3 ? "X" : ""}</td>
<td class="text-center" contenteditable="true">${hasCoverage ? "X" : ""}</td>
<td class="text-center" contenteditable="true">${course.credits_ltp.endsWith(":1") && co.bloom_level >= 4 ? "X" : ""}</td>
</tr>`);
      } else {
        tbody.append(`
<tr>
<td class="static text-center" style="font-weight: bold;">${co.id}</td>
<td class="text-center" contenteditable="true">${hasCoverage ? "X" : ""}</td>
<td class="text-center" contenteditable="true">${hasCoverage && co.bloom_level >= 3 ? "X" : ""}</td>
<td class="text-center" contenteditable="true">${hasCoverage && co.bloom_level >= 3 ? "X" : ""}</td>
<td class="text-center" contenteditable="true">${hasCoverage ? "X" : ""}</td>
</tr>`);
      }
    }

    const colSpan = templateName === "integrated" ? 7 : 5;
    tbody.append(`
<tr>
<td class="static" colspan="${colSpan}" style="font-style: italic;">The details of number of tests and assignments to be conducted are presented in the Academic Regulations and Programme Specifications Document.</td>
</tr>`);
  }

  // Final sanitization to remove template placeholder leftovers
  let result = $.html();
  result = result.replace(/AIC304A/g, course.code);
  result = result.replace(/Computer Vision/g, course.title);

  return result;
}
