import type { LlmConfig } from "./llm.js";
import { extractDocumentContent, parseBlueprint, parseSpecification } from "./parser.js";
import { generateCoPoPsoMap } from "./mapper.js";
import { inspectDefects } from "./inspector.js";
import { generateSpecHtml, selectTemplate } from "./template.js";
import { SpecForgeOutputSchema, type SpecForgeOutput } from "./schema.js";

export interface GenerateInput {
  specBuffer: Buffer;
  specFilename: string;
  blueprintBuffer?: Buffer;
  blueprintFilename?: string;
  llmConfig?: LlmConfig;
  inputId?: string;
}

export interface GenerateResult {
  output: SpecForgeOutput;
  html: string;
}

export async function runGeneratePipeline(input: GenerateInput): Promise<GenerateResult> {
  // 1. Extract content from uploaded spec
  const specDoc = await extractDocumentContent(input.specBuffer, input.specFilename);
  const parsedSpec = parseSpecification(specDoc.text, specDoc.html);

  // 2. Extract content from optional blueprint
  let parsedBlueprint;
  if (input.blueprintBuffer && input.blueprintFilename) {
    const bpDoc = await extractDocumentContent(input.blueprintBuffer, input.blueprintFilename);
    parsedBlueprint = parseBlueprint(bpDoc.text);
  }

  // 3. Source of Truth resolution
  // Course Outcomes and unit-wise syllabus come from the blueprint when present; everything else from spec
  const finalCos = parsedBlueprint && parsedBlueprint.course_outcomes.length > 0
    ? parsedBlueprint.course_outcomes
    : parsedSpec.course_outcomes;

  let finalUnits = parsedSpec.units;
  if (parsedBlueprint && parsedBlueprint.units.length > 0) {
    finalUnits = parsedBlueprint.units.map((bu) => {
      const matchingSpecUnit = parsedSpec.units.find((su) => su.number === bu.number);
      return {
        number: bu.number,
        title: bu.title,
        lab: matchingSpecUnit?.lab ?? null,
      };
    });
  }

  // 4. Template Selection
  const templateName = selectTemplate(parsedSpec.course);

  // 5. Generate fresh CO-PO-PSO map with justifications
  const mapResult = await generateCoPoPsoMap(
    parsedSpec.course,
    finalCos,
    finalUnits,
    parsedSpec.assessment.components,
    input.llmConfig
  );

  // 6. Inspect defects deterministically
  const defects = inspectDefects(parsedSpec, parsedBlueprint, templateName);

  // 7. Generate filled HTML specification document
  const htmlDoc = generateSpecHtml(
    templateName,
    parsedSpec.course,
    finalCos,
    finalUnits,
    mapResult,
    parsedSpec.teaching_hours,
    parsedSpec.assessment
  );

  // 8. Assemble final specforge_output conforming to schema
  const outputData: SpecForgeOutput = {
    schema_version: "1.0",
    input_id: input.inputId || "SAMPLE",
    template: templateName,
    course: parsedSpec.course,
    course_outcomes: finalCos,
    units: finalUnits,
    co_po_pso_map: mapResult,
    teaching_hours: parsedSpec.teaching_hours,
    assessment: parsedSpec.assessment,
    defects,
  };

  // 9. Strict Zod validation
  const validatedOutput = SpecForgeOutputSchema.parse(outputData);

  return {
    output: validatedOutput,
    html: htmlDoc,
  };
}
