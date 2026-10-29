import type { Defect } from "./schema.js";
import type { ParsedBlueprint, ParsedSpec } from "./parser.js";

export function inspectDefects(
  spec: ParsedSpec,
  blueprint?: ParsedBlueprint,
  selectedTemplate?: "integrated" | "non_lab"
): Defect[] {
  const defects: Defect[] = [];

  // V1 & V4: Check for COs missing in Section 5 map table
  if (spec.raw_map) {
    const mapCoKeys = Object.keys(spec.raw_map);
    for (const co of spec.course_outcomes) {
      if (!mapCoKeys.includes(co.id)) {
        defects.push({
          code: "CO_MISSING_IN_TABLE",
          location: {
            source: "spec",
            section: 5,
            refs: [co.id],
          },
          description: `${co.id} is defined in Course Outcomes (Section 3) but missing from the CO-PO-PSO Map in Section 5.`,
          fix: `Generated appropriate mapping and justifications for ${co.id} in Section 5.`,
        });
      }
    }
  }

  // V4: Check for COs extra in Section 7 assessment table (e.g. CO-6 in sample)
  if (spec.assessment && spec.assessment.co_coverage) {
    const definedCoIds = new Set(spec.course_outcomes.map((c) => c.id));
    for (const assessedCo of Object.keys(spec.assessment.co_coverage)) {
      if (!definedCoIds.has(assessedCo)) {
        defects.push({
          code: "CO_EXTRA_IN_TABLE",
          location: {
            source: "spec",
            section: 7,
            refs: [assessedCo],
          },
          description: `${assessedCo} is evaluated in the Assessment table (Section 7) but is not defined in Course Outcomes.`,
          fix: `Removed undefined ${assessedCo} from the evaluation table to align with Section 3.`,
        });
      }
    }
  }

  // V8: Check for PSO column mismatch (e.g. PSO-3 in Section 5)
  if (spec.raw_map_psos && spec.raw_map_psos.length > 0) {
    const invalidPsos = spec.raw_map_psos.filter((p) => p !== "PSO-1" && p !== "PSO-2");
    if (invalidPsos.length > 0) {
      defects.push({
        code: "PSO_COLUMN_MISMATCH",
        location: {
          source: "spec",
          section: 5,
          refs: invalidPsos,
        },
        description: `Course map table contains non-standard PSO columns (${invalidPsos.join(", ")}). Programme has PSO-1 and PSO-2 only.`,
        fix: `Removed extraneous PSO columns and aligned mapping strictly to PSO-1 and PSO-2.`,
      });
    }
  }

  // Blueprint marks inconsistency check (e.g. 60 vs 50)
  if (blueprint && blueprint.maximum_marks && blueprint.unit_marks_sum) {
    if (blueprint.unit_marks_sum !== blueprint.maximum_marks) {
      defects.push({
        code: "MARKS_INCONSISTENT",
        location: {
          source: "blueprint",
          section: null,
          refs: [],
        },
        description: `Sum of unit-wise marks (${blueprint.unit_marks_sum}) in blueprint exceeds stated maximum marks (${blueprint.maximum_marks}).`,
        fix: `Recorded blueprint marks mismatch and normalized assessment weightages.`,
      });
    }
  }

  // Blueprint title/code mismatch
  if (blueprint && blueprint.course_code && spec.course.code) {
    if (blueprint.course_code.trim().toUpperCase() !== spec.course.code.trim().toUpperCase()) {
      defects.push({
        code: "LABEL_OR_TITLE_MISMATCH",
        location: {
          source: "blueprint",
          section: null,
          refs: [blueprint.course_code, spec.course.code],
        },
        description: `Course code in blueprint (${blueprint.course_code}) does not match spec (${spec.course.code}).`,
        fix: `Adopted official course code from specification.`,
      });
    }
  }

  // Section not in template (e.g. Section 10 Course Organization)
  if (spec.extra_sections && spec.extra_sections.length > 0) {
    defects.push({
      code: "SECTION_NOT_IN_TEMPLATE",
      location: {
        source: "spec",
        section: 10,
        refs: [],
      },
      description: `Course spec includes non-standard section(s): ${spec.extra_sections.join(", ")} which have no slot in official template.`,
      fix: `Omitted non-template section from rendered output and recorded in validation report.`,
    });
  }

  // V9: Check original map for Bloom level ceiling violations
  if (spec.raw_map) {
    for (const co of spec.course_outcomes) {
      const coMap = spec.raw_map[co.id];
      if (coMap) {
        for (const [col, level] of Object.entries(coMap)) {
          if (level && level > co.bloom_level) {
            defects.push({
              code: "MAPPING_BLOOM_MISMATCH",
              location: {
                source: "spec",
                section: 5,
                refs: [co.id, col],
              },
              description: `${co.id} (Bloom's level L${co.bloom_level}) is mapped to ${col} with strength ${level}, exceeding Bloom's ceiling.`,
              fix: `Clamped mapping strength to ${co.bloom_level} to respect Bloom's ceiling.`,
            });
          }
        }
      }
    }
  }

  // V5: Teaching hours sum
  if (spec.teaching_hours) {
    const { lectures, lab, tests_exams, total } = spec.teaching_hours;
    if (lectures !== undefined && lab !== undefined && tests_exams !== undefined && total !== undefined) {
      const sum = lectures + lab + tests_exams;
      if (sum !== total && total > 0 && Math.abs(sum - total) > 1) {
        defects.push({
          code: "HOURS_INCONSISTENT",
          location: {
            source: "spec",
            section: 6,
            refs: [],
          },
          description: `Teaching hours rows (${lectures} + ${lab} + ${tests_exams} = ${sum}) do not equal stated total (${total}).`,
          fix: `Adjusted teaching hours total to match sum of components.`,
        });
      }
    }
  }

  // V6: Assessment weightages sum
  if (spec.assessment && spec.assessment.components) {
    const totalWeight = spec.assessment.components.reduce((sum, c) => sum + c.weight_percent, 0);
    if (Math.abs(totalWeight - 100) > 0.01) {
      defects.push({
        code: "WEIGHTAGE_INCONSISTENT",
        location: {
          source: "spec",
          section: 7,
          refs: [],
        },
        description: `Assessment component weightages sum to ${totalWeight}%, not the required 100%.`,
        fix: `Normalized component weightages to total exactly 100%.`,
      });
    }
  }

  // V3: Every CO is assessed
  const allCoIds = spec.course_outcomes.map((c) => c.id);
  const coveredCoIds = new Set(Object.keys(spec.assessment.co_coverage));
  for (const coId of allCoIds) {
    const comps = spec.assessment.co_coverage[coId];
    if (!comps || comps.length === 0) {
      defects.push({
        code: "CO_ASSESSMENT_MISMATCH",
        location: {
          source: "spec",
          section: 7,
          refs: [coId],
        },
        description: `${coId} is not covered in any assessment component.`,
        fix: `Assigned ${coId} to appropriate assessment evaluation components.`,
      });
    }
  }

  return defects;
}
