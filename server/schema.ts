import { z } from "zod";

export const CourseInfoSchema = z.object({
  title: z.string().min(1),
  code: z.string().min(1),
  department: z.string().min(1),
  credits_ltp: z.string().regex(/^\d+:\d+:\d+$/),
  course_type: z.string().min(1),
  summary: z.string().min(1),
});

export const CourseOutcomeSchema = z.object({
  id: z.string().regex(/^CO-\d+$/),
  statement: z.string().min(1),
  bloom_level: z.number().int().min(1).max(6),
});

export const UnitSchema = z.object({
  number: z.number().int(),
  title: z.string().min(1),
  lab: z.string().nullable().optional(),
});

export const MapCellSchema = z.object({
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  justification: z.string().min(1),
});

export const CoPoPsoMapSchema = z.record(
  z.string(),
  z.record(z.string().regex(/^(PO-([1-9]|1[01])|PSO-\d+)$/), MapCellSchema.nullable().optional())
);

export const TeachingHoursSchema = z.record(z.string(), z.number());

export const AssessmentComponentSchema = z.object({
  name: z.string().min(1),
  weight_percent: z.number(),
});

export const AssessmentSchema = z.object({
  components: z.array(AssessmentComponentSchema),
  co_coverage: z.record(z.string(), z.array(z.string())),
});

export const DefectCodeSchema = z.enum([
  "CO_MISSING_IN_TABLE",
  "CO_EXTRA_IN_TABLE",
  "CO_ASSESSMENT_MISMATCH",
  "PSO_COLUMN_MISMATCH",
  "MAPPING_BLOOM_MISMATCH",
  "MAPPING_UNSUPPORTED",
  "WRONG_TEMPLATE",
  "PLACEHOLDER_TEXT",
  "SUMMARY_SYLLABUS_MISMATCH",
  "LABEL_OR_TITLE_MISMATCH",
  "HOURS_INCONSISTENT",
  "WEIGHTAGE_INCONSISTENT",
  "TYPO_OR_FORMAT",
  "SECTION_NOT_IN_TEMPLATE",
  "MARKS_INCONSISTENT",
  "OTHER"
]);

export const DefectLocationSchema = z.object({
  source: z.enum(["spec", "blueprint", "template"]),
  section: z.number().int().min(1).max(12).nullable(),
  refs: z.array(z.string()),
});

export const DefectSchema = z.object({
  code: DefectCodeSchema,
  location: DefectLocationSchema,
  description: z.string().min(1),
  fix: z.string().min(1),
});

export const SpecForgeOutputSchema = z.object({
  schema_version: z.literal("1.0"),
  input_id: z.string(),
  template: z.enum(["integrated", "non_lab"]),
  course: CourseInfoSchema,
  course_outcomes: z.array(CourseOutcomeSchema).min(1),
  units: z.array(UnitSchema),
  co_po_pso_map: CoPoPsoMapSchema,
  teaching_hours: TeachingHoursSchema,
  assessment: AssessmentSchema,
  defects: z.array(DefectSchema),
});

export type SpecForgeOutput = z.infer<typeof SpecForgeOutputSchema>;
export type CourseInfo = z.infer<typeof CourseInfoSchema>;
export type CourseOutcome = z.infer<typeof CourseOutcomeSchema>;
export type Unit = z.infer<typeof UnitSchema>;
export type MapCell = z.infer<typeof MapCellSchema>;
export type Defect = z.infer<typeof DefectSchema>;
