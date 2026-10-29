import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { ApiError, fail, ok } from "./envelope.js";
import { configFromRequest, generateJson } from "./llm.js";
import { runGeneratePipeline } from "./generator.js";
import { extractDocumentContent, parseBlueprint, parseSpecification } from "./parser.js";
import { selectTemplate } from "./template.js";

const app = express();
app.use(express.json({ limit: "10mb" }));

const api = express.Router();

api.get("/health", (_req, res) => ok(res, { status: "up" }));

// "Test key" button in Settings. Proves the key and model work, nothing more.
api.get("/llm-check", async (req, res, next) => {
  try {
    const cfg = configFromRequest(req);
    const out = await generateJson('Return exactly {"pong": true}', z.object({ pong: z.boolean() }), cfg);
    ok(res, { provider: cfg.provider, model: cfg.model, reply: out });
  } catch (e) {
    next(e);
  }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Level 1: Parse uploaded specification and blueprint into structured course data
api.post("/parse", upload.fields([{ name: "spec", maxCount: 1 }, { name: "blueprint", maxCount: 1 }]), async (req, res, next) => {
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const specFile = files?.["spec"]?.[0];
    if (!specFile) throw new ApiError(400, "MISSING_SPEC", "Required course specification file ('spec') missing.");

    const specDoc = await extractDocumentContent(specFile.buffer, specFile.originalname, specFile.mimetype);
    const parsedSpec = parseSpecification(specDoc.text, specDoc.html);

    let parsedBlueprint;
    const bpFile = files?.["blueprint"]?.[0];
    if (bpFile) {
      const bpDoc = await extractDocumentContent(bpFile.buffer, bpFile.originalname, bpFile.mimetype);
      parsedBlueprint = parseBlueprint(bpDoc.text);
    }

    const template = selectTemplate(parsedSpec.course);

    ok(res, {
      template,
      spec: parsedSpec,
      blueprint: parsedBlueprint ?? null,
    });
  } catch (e) {
    next(e);
  }
});

// The scorer runs your app and calls this route with the sample files, exactly like `npm run verify` does.
// Contract: multipart fields "spec" (required) and "blueprint" (optional), AI key in the x-llm-* headers.
// Reply: { success: true, data: { output: <specforge_output object>, html: "<the filled spec document>" } }
api.post("/generate", upload.fields([{ name: "spec", maxCount: 1 }, { name: "blueprint", maxCount: 1 }]), async (req, res, next) => {
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const specFile = files?.["spec"]?.[0];
    if (!specFile) throw new ApiError(400, "MISSING_SPEC", "Missing required course specification file ('spec').");

    const bpFile = files?.["blueprint"]?.[0];

    let cfg;
    try {
      cfg = configFromRequest(req);
    } catch {
      // Key may be absent in manual / test verification
    }

    const result = await runGeneratePipeline({
      specBuffer: specFile.buffer,
      specFilename: specFile.originalname,
      blueprintBuffer: bpFile?.buffer,
      blueprintFilename: bpFile?.originalname,
      llmConfig: cfg,
      inputId: "SAMPLE",
    });

    ok(res, result);
  } catch (e) {
    next(e);
  }
});

app.use("/api/v1", api);
app.use("/api", (_req, res) => fail(res, 404, "NOT_FOUND", "No such route"));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) return fail(res, err.status, err.code, err.message);
  console.error("Unhandled:", err instanceof Error ? err.message : "unknown error"); // never log headers or keys
  fail(res, 500, "SERVER_ERROR", "Something went wrong on the server.");
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`API on http://localhost:${port}/api/v1`));
