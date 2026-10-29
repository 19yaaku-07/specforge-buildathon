import { readFileSync } from "node:fs";
import { z } from "zod";
import type { LlmConfig } from "./llm.js";
import { generateJson } from "./llm.js";
import type { CourseInfo, CourseOutcome, Unit } from "./schema.js";

export interface PoPsoData {
  scale: string;
  pos: Array<{ id: string; title: string; statement: string }>;
  psos: Array<{ id: string; statement: string }>;
  blooms: Array<{ level: string; name: string; verbs: string }>;
}

let cachedPoPso: PoPsoData | null = null;

export function loadPoPso(): PoPsoData {
  if (cachedPoPso) return cachedPoPso;
  const raw = readFileSync("config/po_pso.json", "utf-8");
  cachedPoPso = JSON.parse(raw);
  return cachedPoPso!;
}

export type MapResult = Record<string, Record<string, { level: 1 | 2 | 3; justification: string }>>;

// Schema for LLM generation response
const GeneratedMapResponseSchema = z.object({
  mapping: z.record(
    z.string(),
    z.record(
      z.string(),
      z.object({
        level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        justification: z.string(),
      }).nullable().optional()
    )
  ),
});

export async function generateCoPoPsoMap(
  course: CourseInfo,
  cos: CourseOutcome[],
  units: Unit[],
  assessmentComponents: Array<{ name: string; weight_percent: number }>,
  cfg?: LlmConfig
): Promise<MapResult> {
  const poPso = loadPoPso();
  const poList = poPso.pos.map((p) => `${p.id} (${p.title}): ${p.statement}`).join("\n");
  const psoList = poPso.psos.map((p) => `${p.id}: ${p.statement}`).join("\n");

  const prompt = `You are an expert accreditation curriculum evaluator.
Course Title: ${course.title}
Course Code: ${course.code}
Summary: ${course.summary}

Course Outcomes:
${cos.map((co) => `${co.id}: ${co.statement} (Bloom Level: L${co.bloom_level})`).join("\n")}

Syllabus Units:
${units.map((u) => `Unit ${u.number}: ${u.title}${u.lab ? ` (Lab: ${u.lab})` : ""}`).join("\n")}

Assessment Components:
${assessmentComponents.map((c) => `${c.name} (${c.weight_percent}%)`).join(", ")}

Program Outcomes:
${poList}

Program Specific Outcomes:
${psoList}

Rules for CO-PO-PSO Mapping:
1. Scale: 3 (Very strong), 2 (Strong), 1 (Moderate).
2. Bloom's Ceiling: A CO cannot map to any PO or PSO with strength greater than its Bloom's level. (e.g. If Bloom Level is 2, strength cannot exceed 2).
3. Every CO must map to at least one PO.
4. PO-5 requires evidence of programming/modern tool use.
5. PO-6 to PO-10 need explicit syllabus or assessment evidence; omit (leave blank/null) if unsupported.
6. Columns are PO-1 to PO-11 and PSO-1, PSO-2 only.
7. For every non-empty mapping, provide a concise one-line justification explaining the connection.
8. Do not return empty cells in the final object or return null.

Return JSON in this format:
{
  "mapping": {
    "CO-1": {
      "PO-1": { "level": 2, "justification": "Applies foundational knowledge to explain computing principles." },
      "PSO-1": { "level": 2, "justification": "Explains foundational computing concepts and algorithms." }
    }
  }
}`;

  let rawMap: MapResult = {};

  if (cfg && cfg.key && !cfg.key.startsWith("dummy")) {
    try {
      const aiPromise = generateJson(prompt, GeneratedMapResponseSchema, cfg);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("AI call timed out after 15s")), 15000)
      );
      const response = await Promise.race([aiPromise, timeoutPromise]);
      const m = response.mapping;

      for (const co of cos) {
        rawMap[co.id] = {};
        const coMap = m[co.id] || {};
        for (const [col, cell] of Object.entries(coMap)) {
          if (cell && (cell.level === 1 || cell.level === 2 || cell.level === 3)) {
            // Enforce Bloom ceiling
            const effectiveLevel = Math.min(cell.level, co.bloom_level) as 1 | 2 | 3;
            rawMap[co.id][col] = {
              level: effectiveLevel,
              justification: cell.justification.trim() || `Addresses ${col} through course outcomes.`,
            };
          }
        }
      }
    } catch (err) {
      console.warn("AI generation fallback to deterministic mapper:", err instanceof Error ? err.message : err);
      rawMap = buildDeterministicMap(course, cos, units, poPso);
    }
  } else {
    rawMap = buildDeterministicMap(course, cos, units, poPso);
  }

  // Ensure every CO maps to at least one PO and respects all constraints
  const finalMap: MapResult = {};
  for (const co of cos) {
    finalMap[co.id] = {};
    const cells = rawMap[co.id] || {};

    for (const [k, v] of Object.entries(cells)) {
      if (/^(PO-([1-9]|1[01])|PSO-[12])$/.test(k) && v && (v.level === 1 || v.level === 2 || v.level === 3)) {
        const clampedLevel = Math.min(v.level, co.bloom_level) as 1 | 2 | 3;
        finalMap[co.id][k] = {
          level: clampedLevel,
          justification: v.justification,
        };
      }
    }

    // If no PO mapped, map PO-1 or PO-2 within Bloom's level
    const hasPo = Object.keys(finalMap[co.id]).some((k) => k.startsWith("PO-"));
    if (!hasPo) {
      const targetPo = co.bloom_level >= 3 ? "PO-2" : "PO-1";
      finalMap[co.id][targetPo] = {
        level: Math.min(2, co.bloom_level) as 1 | 2 | 3,
        justification: `Covers ${targetPo} through analysis and execution of core principles.`,
      };
    }
  }

  return finalMap;
}

// Deterministic baseline mapper that guarantees valid, justified mappings
function buildDeterministicMap(
  course: CourseInfo,
  cos: CourseOutcome[],
  units: Unit[],
  poPso: PoPsoData
): MapResult {
  const result: MapResult = {};

  for (const co of cos) {
    result[co.id] = {};
    const lvl = co.bloom_level;

    // PO-1 (Engineering Knowledge)
    const po1Lvl = Math.min(lvl >= 2 ? 2 : 1, lvl) as 1 | 2 | 3;
    result[co.id]["PO-1"] = {
      level: po1Lvl,
      justification: `Applies engineering and mathematical fundamentals to ${co.statement.toLowerCase().slice(0, 70)}.`,
    };

    // PO-2 (Problem Analysis)
    if (lvl >= 2) {
      const po2Lvl = Math.min(lvl >= 3 ? (lvl >= 4 ? 3 : 2) : 1, lvl) as 1 | 2 | 3;
      result[co.id]["PO-2"] = {
        level: po2Lvl,
        justification: `Formulates and analyzes computable problems using systematic methodologies.`,
      };
    }

    // PO-3 (Design / Solutions)
    if (lvl >= 3) {
      const po3Lvl = Math.min(lvl >= 5 ? 3 : 2, lvl) as 1 | 2 | 3;
      result[co.id]["PO-3"] = {
        level: po3Lvl,
        justification: `Designs programmatic solutions and algorithmic structures to meet specified constraints.`,
      };
    }

    // PO-4 (Investigations)
    if (lvl >= 4) {
      result[co.id]["PO-4"] = {
        level: Math.min(2, lvl) as 1 | 2 | 3,
        justification: `Investigates alternative algorithms and comparative complexities to substantiate conclusions.`,
      };
    }

    // PO-5 (Tool Usage)
    if (course.credits_ltp.endsWith(":1") || course.course_type.toLowerCase().includes("lab")) {
      if (lvl >= 3) {
        result[co.id]["PO-5"] = {
          level: Math.min(2, lvl) as 1 | 2 | 3,
          justification: `Applies modern programming languages, IDEs, and simulation tools during hands-on exercises.`,
        };
      }
    }

    // PSO-1
    result[co.id]["PSO-1"] = {
      level: Math.min(lvl >= 3 ? 3 : 2, lvl) as 1 | 2 | 3,
      justification: `Solves computational engineering problems using algorithms and structured programming.`,
    };

    // PSO-2
    if (lvl >= 3) {
      result[co.id]["PSO-2"] = {
        level: Math.min(lvl >= 5 ? 3 : 2, lvl) as 1 | 2 | 3,
        justification: `Implements reliable software solutions using standard development practices.`,
      };
    }
  }

  return result;
}
