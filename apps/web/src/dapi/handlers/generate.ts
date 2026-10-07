/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


import { getAssetFile, getLibrary } from "@diffusionstudio/runtime";
import { DapiError, generatedPath, isLocalJobId, isLocalModel } from "@diffusionstudio/dapi";

import { api } from "@/lib/api";
import { uploadFile } from "@/lib/uploads";
import { encodeSceneAudio, hasAudio } from "@/engine/scene-audio";
import { resolveAsset } from "../lib/assets";
import { audioFile } from "../lib/audio";
import { destination, storeAt } from "../lib/outputs";
import { apiError, requireSignIn } from "../lib/remote";
import { requireScene } from "../lib/scene";
import { localJob, startLocalJob } from "../local/jobs";

import type { Asset, AssetLibrary } from "@diffusionstudio/assets";
import type { AssetRef, GenerateRequestInput, Job } from "@diffusionstudio/api-contract";
import type { GenerationResult } from "@diffusionstudio/dapi";
import type { ToolContext, ToolHandler } from "../handler";
import type { Destination } from "../lib/outputs";

/**
 * Starts a job: on the API, or, for a model that runs on this machine, in the
 * app (see ../local). Both answer with the API's `Job`, and `job` polls both.
 */
export const generate: ToolHandler<"generate"> = async (args, ctx) => {
  if (isLocalModel(args.model)) {
    return startLocalJob(args, destination(args.output, ctx.session()), ctx);
  }

  const { output, maxCredits, estimate, ...request } = args;
  await requireSignIn();

  if (estimate) {
    try {
      const { credits, etaSeconds } = await api.estimate.query((await withUploads(request, ctx)) as GenerateRequestInput);
      return { credits, etaSeconds };
    } catch (error) {
      throw apiError(error);
    }
  }

  const target = destination(output, ctx.session());

  try {
    const job = await api.generate.mutate({
      request: (await withUploads(request, ctx)) as GenerateRequestInput,
      idempotencyKey: crypto.randomUUID(),
      maxCredits,
    });

    destinations.set(job.id, target);
    return present(job, ctx);
  } catch (error) {
    throw apiError(error);
  }
};

export const job: ToolHandler<"job"> = async ({ id, cancel }, ctx) => {
  if (isLocalJobId(id)) {
    return localJob(id, cancel ?? false);
  }

  await requireSignIn();

  try {
    let job: Job;
    if (cancel) {
      job = await api.jobs.cancel.mutate({ id });
    } else {
      job = await api.jobs.get.query({ id });
    }

    return present(job, ctx);
  } catch (error) {
    throw apiError(error);
  }
};

// ── Requests ─────────────────────────────────────────────────

type FileRef = { path: string };
type SceneRef = { scene: string };

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `{ path }` and nothing else: a file the caller means, as opposed to a field of the API's. */
const isFileRef = (value: unknown): value is FileRef => {
  return isPlainObject(value) && typeof value.path === "string" && Object.keys(value).length === 1;
}

/** `{ scene }` and nothing else: a scene whose audio the caller means. */
const isSceneRef = (value: unknown): value is SceneRef => {
  return isPlainObject(value) && typeof value.scene === "string" && Object.keys(value).length === 1;
}

/**
 * The request with every `{ path }` and `{ scene }` uploaded and replaced by
 * the ref the API names it by; the rest untouched. `field` is the key the
 * value sits under (an array's items sit under the array's).
 */
async function withUploads(value: unknown, ctx: ToolContext, field?: string): Promise<unknown> {
  if (isFileRef(value)) return upload(value.path, field, ctx);
  if (isSceneRef(value)) return uploadScene(value.scene, field, ctx);
  if (Array.isArray(value)) return Promise.all(value.map((item) => withUploads(item, ctx, field)));
  if (!isPlainObject(value)) return value;
  const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await withUploads(item, ctx, key)] as const));
  return Object.fromEntries(entries);
}

/** A file uploaded; in an `audio` field only its sound, so a video's picture is not sent to be ignored. */
async function upload(path: string, field: string | undefined, ctx: ToolContext): Promise<AssetRef> {
  const asset = await resolveAsset(ctx, path);
  return uploadFile(field === "audio" ? await audioFile(asset) : await getAssetFile(asset));
}

/**
 * The scene's audible mix, rendered from its start to its end and uploaded,
 * so the times of what comes back (a transcript's words) are scene times. Audio
 * only: what a scene would be as a picture or a video is a frame to pick or a
 * full export to run, which `capture` and `export` are for. Checked before
 * anything renders, and the render runs before the job starts, so a scene
 * with nothing to hear never costs credits.
 */
async function uploadScene(id: string, field: string | undefined, ctx: ToolContext): Promise<AssetRef> {
  if (field !== "audio") {
    throw new DapiError(
      "invalid-input",
      `A { "scene" } reference sends the scene's audio, so it goes in an \`audio\` field${field ? ` (got \`${field}\`)` : ""}.`,
    );
  }
  const { world, project } = ctx.requireSession();
  const scene = requireScene(world, id, "send", `{ "scene" } sends a scene's audio`);
  if (!hasAudio(world, scene)) {
    throw new DapiError("invalid-input", `Scene "${id}" has nothing to hear: no unmuted, visible audio or video clip in it.`);
  }
  const audio = await encodeSceneAudio(world, scene, project.dir());
  return uploadFile(audio);
}

// ── Where the files go ───────────────────────────────────────

/** Where each job started here saves its files; a job started elsewhere (the prompt box, before a reload) gets the default. */
const destinations = new Map<string, Destination>();

/** Library saves in flight or done, by job id: the first poll that sees a job succeed saves it, the rest wait for that. */
const saves = new Map<string, Promise<Asset[]>>();

/**
 * The job, its files saved into the library when that is where they go; files
 * bound for disk keep their `url` for the server. A library destination with
 * no project open any more falls back to the temp dir.
 */
async function present(job: Job, ctx: ToolContext): Promise<GenerationResult> {
  const session = ctx.session();
  let target = destinations.get(job.id) ?? destination(undefined, session);
  if (target.kind === "library" && !session) target = { kind: "disk", path: null };
  if (job.status !== "succeeded" || target.kind === "disk") {
    return { job, saveTo: target.kind === "disk" ? target.path : null };
  }

  const library = getLibrary(session!.world);
  let saved = saves.get(job.id);
  if (!saved) {
    saved = saveToLibrary(library, job, target.path);
    saved.catch(() => saves.delete(job.id));
    saves.set(job.id, saved);
  }
  const assets = await saved;
  const dir = session!.project.dir();
  return {
    job: {
      ...job,
      assets: job.assets.map(({ url: _url, ...file }, i) => ({ ...file, path: `${dir}/${assets[i]!.source}`, src: assets[i]!.path })),
    },
    saveTo: null,
  };
}

/**
 * Downloads each file into the library, noting the job it came from, as the
 * prompt box does. Files the library already holds from this job (saved by
 * the prompt box, or before a reload) are not downloaded again.
 */
async function saveToLibrary(library: AssetLibrary, job: Job, output: string | null): Promise<Asset[]> {
  // Newest first; the files were stored in order.
  const existing = library.list().filter((asset) => asset.job === job.id).reverse();
  if (existing.length >= job.assets.length) return existing;

  const assets: Asset[] = [];
  for (const [i, file] of job.assets.entries()) {
    const response = await fetch(file.url);
    if (!response.ok) throw new Error(`Could not download ${file.filename} (${response.status})`);
    const path = output === null ? file.filename : generatedPath(output, file.filename, i, job.assets.length);
    const asset = await storeAt(library, path, await response.blob());
    assets.push(library.update(asset, { job: job.id }));
  }
  return assets;
}
