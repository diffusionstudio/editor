/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Generation on the Diffusion Studio API, nearly as the API has it: a request
// is the API's own (`model` plus that model's fields), passed through for the
// API to validate, and a job is the API's `Job`. What the tools add is what
// only a local client can do: send local files, and save what a job made.

import { z } from "zod";
import { MODEL_IDS } from "@diffusionstudio/api-contract";
import { defineTool } from "../tool";

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
});

/**
 * What the renderer hands back: the job as the API has it, each file either
 * saved into the library already (`path`, `src`) or still at its `url`, for
 * the server to download to `saveTo` (see `generatedPath`; null: a fresh
 * directory under the system temp dir, under the API's names).
 */
export const GenerationResult = z.object({
  job: z.looseObject({
    id: z.string(),
    status: z.string(),
    assets: z.array(z.looseObject({ url: z.string().optional(), path: z.string().optional(), filename: z.string() })),
  }),
  saveTo: z.string().nullable(),
});

export const generate = defineTool({
  name: "generate",
  title: "Generate media",
  description:
    "Start a job on a generative model of the Diffusion Studio API — images, video, music, sound effects, speech, and tools such as background removal, upscaling, transcription and analysis — and return the job at once, with its estimated run time and the credits it costs. The input is the API's request: `model` plus that model's fields (`prompt`, `images`, `aspectRatio`, `duration`, `voice`, …), listed per model in the docs at `reference/models.md`. The fields are passed through as given and the API validates them, answering with what to fix. Where a field takes a file, put `{ \"path\": \"…\" }` — an absolute path, a URL, or a library path — and it is uploaded first. Poll `job` with the returned id until its status is succeeded, failed or canceled; the estimate says when to look. Generating needs a signed-in account and spends its credits.",
  input: z.looseObject({
    model: z.enum(MODEL_IDS).describe("the model to run; its fields are listed in `reference/models.md`"),
    output: z
      .string()
      .optional()
      .describe(
        "file the result is saved as: a library path like `b-roll/fox.png` (needs an open project) or an absolute path; its extension is corrected to what the model made, several files are numbered (`fox-1.png`, `fox-2.png`), and a file already there is replaced (default: the library's root under the API's name with a project open, its files under `assets/`; else a fresh directory under the system temp dir)",
      ),
    maxCredits: z.number().positive().optional().describe("refuse to start the job if it costs more credits than this"),
  }),
  output: GenerationJob,
  result: GenerationResult,
  environment: "renderer",
});

export const job = defineTool({
  name: "job",
  title: "Generation job",
  description:
    "The state of a job started with `generate`: its status, progress estimate and cost, and, once it has succeeded, the files it made, saved where `generate` was told (the first call to see it succeed saves them; later calls return the same paths). Poll until the status is succeeded, failed or canceled, waiting about `etaRemainingSeconds` (or `etaSeconds` while queued) between calls. `cancel` stops a job and refunds its credits.",
  input: z.object({
    id: z.string().min(1).describe("job id, as `generate` returned it"),
    cancel: z.boolean().optional().describe("cancel the job, refunding its credits"),
  }),
  output: GenerationJob,
  result: GenerationResult,
  environment: "renderer",
});
