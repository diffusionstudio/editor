/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Generation on the Diffusion Studio API, nearly as the API has it: a request
// is the API's own (`model` plus that model's fields), passed through for the
// API to validate, and a job is the API's `Job`. What the tools add is what
// only a local client can do: send local files, save what a job made, and
// run the models that work on this machine (see ../local) as jobs of the same
// shape.

import { z } from "zod";
import { MODEL_IDS, generateRequest } from "@diffusionstudio/api-contract";
import { defineTool } from "../tool";
import { Bytes } from "../schemas";
import { LOCAL_MODELS, LOCAL_MODEL_IDS } from "../local";
import { requestFields } from "../local/fields";

const JPEG = /^\.jpe?g$/i;

/**
 * Where file `index` of the `count` a job made is saved when the caller named
 * the output `output`: that path, with the extension of what the model made
 * (`filename`'s) in place of a different one or added when there is none, and
 * numbered (`-1`, `-2`, …) when the job made several. Either separator works,
 * so the renderer and the server agree on library and OS paths alike.
 */
export function generatedPath(output: string, filename: string, index: number, count: number): string {
  const slash = Math.max(output.lastIndexOf("/"), output.lastIndexOf("\\"));
  const base = output.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const given = dot > 0 ? base.slice(dot) : "";
  const made = /\.[^./\\]+$/.exec(filename)?.[0] ?? given;
  const same = given.toLowerCase() === made.toLowerCase() || (JPEG.test(given) && JPEG.test(made));
  return `${output.slice(0, slash + 1)}${stem}${count > 1 ? `-${index + 1}` : ""}${same ? given : made}`;
}

/** A file a job made, once it is on this machine; the API's file with its `url` swapped for where it was saved. */
export const GeneratedFile = z.looseObject({
  path: z.string().describe("absolute path of the file"),
  src: z.string().optional().describe("the file's library path, for `src`; present when it went into the project's library"),
});

/**
 * The API's `Job`, its files saved locally. Only what the tools rely on is
 * spelled out; every other field is the API's, passed through as it is.
 */
export const GenerationJob = z.looseObject({
  id: z.string().describe("job id, for `job`"),
  status: z.string().describe("queued or running while the job works; succeeded, failed or canceled once it has ended — stop polling then"),
  assets: z.array(GeneratedFile).describe("the files the job made, saved: empty until it succeeds"),
  progress: z
    .number()
    .nullable()
    .optional()
    .describe("on a local model's job, 0..1 through its current `phase` (a model's download, then the work); null when there is none to report"),
  details: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("on a local model's job, what the model reports beyond its files, model by model (see `reference/models.md`)"),
});

/**
 * What the renderer hands back: the job as the API has it, each file either
 * saved into the library already (`path`, `src`), still at its `url`, or, from
 * a local model, held as `bytes`: the last two for the server to download or
 * write to `saveTo` (see `generatedPath`; null: a fresh directory under the
 * system temp dir, under the files' own names). `image` is a picture of what
 * a local job made, for the caller to look at: the server writes it to the
 * temp dir once, shows it inline that once, and names it in `details.image`.
 */
export const GenerationResult = z.object({
  job: z.looseObject({
    id: z.string(),
    status: z.string(),
    assets: z.array(
      z.looseObject({ url: z.string().optional(), bytes: Bytes.optional(), path: z.string().optional(), filename: z.string() }),
    ),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
  saveTo: z.string().nullable(),
  image: Bytes.optional(),
});

/** What `generate` answers with `estimate`: the job's price and run time, and no job. */
export const GenerationEstimate = z.object({ credits: z.number(), etaSeconds: z.number() });

/**
 * Every field a model takes, by name only, from the API's request schemas and
 * the local models'. Declared for MCP clients that send only the properties a
 * schema lists; each is `unknown`, so the API (or a local model's own schema)
 * still does all the checking.
 */
const modelFields = Object.fromEntries(
  [...generateRequest.options, ...Object.values(LOCAL_MODELS)]
    .flatMap((schema) => Object.keys(schema.shape))
    .filter((key) => key !== "model" && !(key in requestFields))
    .map((key) => [key, z.unknown().optional()]),
);

export const generate = defineTool({
  name: "generate",
  title: "Generate media",
  description:
    "Start a job on a generative model — images, video, music, sound effects, speech, and tools such as background removal, upscaling, transcription and analysis on the Diffusion Studio API, and object segmentation and tracking (`sam-2.1`) on this machine — and return the job at once, with its estimated run time and the credits it costs. The input is the model's request: `model` plus that model's fields (`prompt`, `images`, `aspectRatio`, `duration`, `voice`, …), listed per model in the docs at `reference/models.md`. An API model's fields are passed through as given and the API validates them, answering with what to fix; a local model's are checked here. Where a field takes a file, put `{ \"path\": \"…\" }` — an absolute path, a URL, or a library path — and it is uploaded first (a local model reads it in place). Poll `job` with the returned id until its status is succeeded, failed or canceled; the estimate says when to look. With `estimate`, nothing starts: the answer is only what the job would cost and how long it would run. API models need a signed-in account and spend its credits; local models run on the GPU, free, and need no account.",
  input: z.looseObject({
    model: z.enum([...MODEL_IDS, ...LOCAL_MODEL_IDS]).describe("the model to run; its fields are listed in `reference/models.md`"),
    ...modelFields,
    output: z
      .string()
      .optional()
      .describe(
        "file the result is saved as: a library path like `b-roll/fox.png` (needs an open project) or an absolute path; its extension is corrected to what the model made, several files are numbered (`fox-1.png`, `fox-2.png`), and a file already there is replaced (default: with a project open, the library's root under the model's name for the file, its files under `assets/`, or the model's own folder where `reference/models.md` gives one; else a fresh directory under the system temp dir)",
      ),
    maxCredits: z.number().positive().optional().describe("refuse to start the job if it costs more credits than this"),
    estimate: z
      .boolean()
      .optional()
      .describe("don't start the job: answer with only its `credits` and `etaSeconds`, spending nothing"),
  }),
  output: GenerationJob.partial({ id: true, status: true, assets: true }).extend({
    credits: z.number().describe("credits the job costs: charged, and refunded if it fails or is canceled; with `estimate`, what it would cost"),
    etaSeconds: z.number().describe("estimated seconds the job runs for"),
  }),
  result: z.union([GenerationResult, GenerationEstimate]),
  environment: "renderer",
});

export const job = defineTool({
  name: "job",
  title: "Generation job",
  description:
    "The state of a job started with `generate`: its status, progress estimate and cost, and, once it has succeeded, the files it made, saved where `generate` was told (the first call to see it succeed saves them; later calls return the same paths), and, from a local model, its `details`. Poll until the status is succeeded, failed or canceled, waiting about `etaRemainingSeconds` (or `etaSeconds` while queued) between calls. `cancel` stops a job and refunds its credits. A local model's job lives in the app: it is gone once the app restarts.",
  input: z.object({
    id: z.string().min(1).describe("job id, as `generate` returned it"),
    cancel: z.boolean().optional().describe("cancel the job, refunding its credits"),
  }),
  output: GenerationJob,
  result: GenerationResult,
  environment: "renderer",
});
