/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { getLibrary } from "@diffusionstudio/runtime";
import { DapiError, LOCAL_JOB_PREFIX, LOCAL_MODELS, generatedPath, isDapiError } from "@diffusionstudio/dapi";

import { storeAt } from "../lib/outputs";
import { localModels } from "./models";

import type { World } from "koota";
import type { Accessor } from "solid-js";
import type { JobErrorCode } from "@diffusionstudio/api-contract";
import type { GenerateRequest, GenerationResult, LocalModelId } from "@diffusionstudio/dapi";
import type { ToolContext } from "../handler";
import type { Destination } from "../lib/outputs";
import type { EditorSession } from "../session";
import type { LocalFile, LocalPlan } from "./model";

type Status = "queued" | "running" | "succeeded" | "failed" | "canceled";

type JobFile = GenerationResult["job"]["assets"][number];

/** A job of a local model, in the API's `Job` shape, with `progress` and `details` of its own. */
type LocalJob = {
  id: string;
  model: LocalModelId;
  request: Record<string, unknown>;
  status: Status;
  phase: string | null;
  progress: number | null;
  credits: 0;
  etaSeconds: number;
  etaRemainingSeconds: number | null;
  name: string | null;
  assets: JobFile[];
  details: Record<string, unknown>;
  error: { code: JobErrorCode; message: string } | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: null;
};

type Entry = {
  job: LocalJob;
  target: Destination;
  /** The world whose library the files go into: closing its project cancels the job. */
  world: World | null;
  controller: AbortController;
  image?: Uint8Array;
};

/** Every local job started since the app loaded, by id. They live as long as the page: a reload forgets them. */
const jobs = new Map<string, Entry>();

/**
 * Checks the request against the model's schema, settles the job with the
 * model (a bad file or time fails here, before any work), and starts it.
 * Answers at once with the job queued, or, for work the model says is quick
 * (`inline`), once it has ended.
 */
export async function startLocalJob(args: GenerateRequest, target: Destination, ctx: ToolContext): Promise<GenerationResult> {
  const model = args.model as LocalModelId;
  const parsed = LOCAL_MODELS[model].safeParse(args);
  if (!parsed.success) {
    throw new DapiError("invalid-input", z.prettifyError(parsed.error));
  }
  const plan = await localModels[model].prepare(parsed.data, ctx);
  const session = ctx.session();
  const entry: Entry = {
    job: {
      id: `${LOCAL_JOB_PREFIX}${crypto.randomUUID()}`,
      model,
      request: modelFields(parsed.data),
      status: "queued",
      phase: "queued",
      progress: null,
      credits: 0,
      etaSeconds: round(plan.etaSeconds),
      etaRemainingSeconds: null,
      name: null,
      assets: [],
      details: plan.details ?? {},
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      expiresAt: null,
    },
    target,
    world: target.kind === "library" ? session!.world : null,
    controller: new AbortController(),
  };
  jobs.set(entry.job.id, entry);

  const done = execute(entry, plan, ctx.session);
  if (plan.inline) {
    // The caller waits for it, so the caller going away stops it.
    const abort = () => entry.controller.abort("The call was canceled.");
    ctx.signal.addEventListener("abort", abort, { once: true });
    await done.finally(() => ctx.signal.removeEventListener("abort", abort));
  }
  return present(entry);
}

/** A local job as it stands, canceled first when `cancel`. */
export function localJob(id: string, cancel: boolean): GenerationResult {
  const entry = jobs.get(id);
  if (!entry) {
    throw new DapiError("not-found", `No local job ${id}: a local model's jobs live in the app, and are gone once it restarts or reloads.`);
  }
  if (cancel && !hasEnded(entry.job)) {
    entry.controller.abort("Canceled.");
    end(entry.job, "canceled", { code: "CANCELED", message: "Canceled." });
  }
  return present(entry);
}

function present({ job, target, image }: Entry): GenerationResult {
  return {
    job: { ...job, assets: job.assets.map((file) => ({ ...file })), details: { ...job.details } },
    saveTo: target.kind === "disk" ? target.path : null,
    ...(image ? { image } : {}),
  };
}

/** Runs the plan and files each step on the job; never rejects, a failure is the job's. */
async function execute(entry: Entry, plan: LocalPlan, current: Accessor<EditorSession | null>): Promise<void> {
  const { job, controller } = entry;
  const { signal } = controller;
  // A project closed in the meantime stops the job at its next report, and
  // nothing is written into a library no longer open.
  const stillOpen = () => {
    if (entry.world && current()?.world !== entry.world) controller.abort("The project was closed before the job finished.");
    return !signal.aborted;
  };
  const start = () => {
    if (job.status !== "queued") return;
    job.status = "running";
    job.phase = "running";
    job.startedAt = new Date().toISOString();
  };

  try {
    const output = await plan.run({
      signal,
      start: () => {
        if (stillOpen()) start();
      },
      report: (phase, progress, etaRemainingSeconds) => {
        if (!stillOpen()) return;
        start();
        Object.assign(job, { phase, progress, etaRemainingSeconds: etaRemainingSeconds === null ? null : round(etaRemainingSeconds) });
      },
    });
    if (!stillOpen()) {
      signal.throwIfAborted();
    }
    start();
    Object.assign(job, { phase: "finalizing", progress: null, etaRemainingSeconds: null });
    const assets = await save(entry, output.files, current);
    if (hasEnded(job)) return;
    job.assets = assets;
    job.details = { ...job.details, ...output.details };
    entry.image = output.image;
    end(job, "succeeded", null);
  } catch (error) {
    if (hasEnded(job)) return;
    if (signal.aborted) {
      end(job, "canceled", { code: "CANCELED", message: String(signal.reason) });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    end(job, "failed", { code: isDapiError(error) && error.code === "invalid-input" ? "INVALID_INPUT" : "INTERNAL", message });
  }
}

/**
 * The files where the job was told: into the library — at `output`, its
 * extension the file's, written over a file the project made there, or under
 * the model's name in its folder, next to anything already there — or held as
 * bytes for the server to write to disk.
 */
async function save(entry: Entry, files: LocalFile[], current: Accessor<EditorSession | null>): Promise<JobFile[]> {
  const { target } = entry;
  const described = (file: LocalFile) => ({ filename: file.filename, mimeType: file.blob.type, size: file.blob.size });
  if (target.kind === "disk") {
    return Promise.all(files.map(async (file) => ({ ...described(file), bytes: new Uint8Array(await file.blob.arrayBuffer()) })));
  }

  const session = current()!;
  const library = getLibrary(session.world);
  const saved: JobFile[] = [];
  for (const [i, file] of files.entries()) {
    const asset =
      target.path === null
        ? await library.store(file.blob, { folder: file.folder ?? "", name: file.filename })
        : await storeAt(library, generatedPath(target.path, file.filename, i, files.length), file.blob);
    saved.push({ ...described(file), path: `${session.project.dir()}/${asset.source}`, src: asset.path });
  }
  return saved;
}

/** The request as the job reports it, as the API's jobs do: the model's fields, not the tool's. */
function modelFields({ output: _output, maxCredits: _maxCredits, ...fields }: Record<string, unknown>): Record<string, unknown> {
  return fields;
}

function end(job: LocalJob, status: Status, error: LocalJob["error"]): void {
  Object.assign(job, { status, error, phase: null, etaRemainingSeconds: null, completedAt: new Date().toISOString() });
  if (status === "succeeded") job.progress = 1;
}

function hasEnded(job: LocalJob): boolean {
  return job.status === "succeeded" || job.status === "failed" || job.status === "canceled";
}

function round(seconds: number): number {
  return Math.max(0, Math.round(seconds * 10) / 10);
}
