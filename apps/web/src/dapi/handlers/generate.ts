/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * `generate` and `job`: the API's generation endpoints with a local layer
 * and nothing more. A request goes out as given, except that `{ path }` file
 * references are uploaded and swapped for the API's asset refs; the API
 * validates the rest. A job comes back as the API has it, except that once it
 * has succeeded its files are saved, here into the library, or by the server
 * to a directory on disk (see `present.ts` in the desktop app).
 */

import { getAssetFile, getLibrary } from "@diffusionstudio/runtime";
import { isAbsoluteSource, isProjectSource, isUrlSource } from "@diffusionstudio/assets";
import { DapiError, generatedPath } from "@diffusionstudio/dapi";
import { TRPCClientError } from "@trpc/client";

import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { uploadFile } from "@/lib/uploads";
import { resolveAsset } from "../lib/assets";

import type { Asset, AssetLibrary } from "@diffusionstudio/assets";
import type { AssetRef, GenerateRequestInput, Job } from "@diffusionstudio/api-contract";
import type { DapiErrorCode, GenerationResult } from "@diffusionstudio/dapi";
import type { ToolContext, ToolHandler } from "../handler";
import type { EditorSession } from "../session";

export const generate: ToolHandler<"generate"> = async ({ output, maxCredits, ...request }, ctx) => {
  await requireSignIn();
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
    if (!(error instanceof TRPCClientError)) throw error;
    const code: string | undefined = error.data?.code;
    const mapped = code && API_ERRORS[code];
    if (mapped) throw new DapiError(mapped, error.message, { cause: error });
    if (code === "PAYMENT_REQUIRED") throw new Error(`Not enough credits: ${error.message}`, { cause: error });
    throw error;
  }
};

export const job: ToolHandler<"job"> = async ({ id, cancel }, ctx) => {
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
    if (!(error instanceof TRPCClientError)) throw error;
    const code: string | undefined = error.data?.code;
    const mapped = code && API_ERRORS[code];
    if (mapped) throw new DapiError(mapped, error.message, { cause: error });
    if (code === "PAYMENT_REQUIRED") throw new Error(`Not enough credits: ${error.message}`, { cause: error });
    throw error;
  }
};

// ── Requests ─────────────────────────────────────────────────

type FileRef = { path: string };

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `{ path }` and nothing else: a file the caller means, as opposed to a field of the API's. */
const isFileRef = (value: unknown): value is FileRef => {
  return isPlainObject(value) && typeof value.path === "string" && Object.keys(value).length === 1;
}

/** The request with every `{ path }` uploaded and replaced by the ref the API names it by; the rest untouched. */
async function withUploads(value: unknown, ctx: ToolContext): Promise<unknown> {
  if (isFileRef(value)) return upload(value.path, ctx);
  if (Array.isArray(value)) return Promise.all(value.map((item) => withUploads(item, ctx)));
  if (!isPlainObject(value)) return value;
  const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await withUploads(item, ctx)] as const));
  return Object.fromEntries(entries);
}

async function upload(path: string, ctx: ToolContext): Promise<AssetRef> {
  const asset = await resolveAsset(ctx, path);
  return uploadFile(await getAssetFile(asset));
}

// ── Where the files go ───────────────────────────────────────

/**
 * Into the library, at `path` (see `generatedPath`) or at its root under the
 * API's names when that is null; or to a path on disk the server writes
 * (null: a fresh directory under the temp dir). Settled when the job starts,
 * so a bad `output` fails before any credits are spent.
 */
type Destination = { kind: "library"; path: string | null } | { kind: "disk"; path: string | null };

/** Where each job started here saves its files; a job started elsewhere (the prompt box, before a reload) gets the default. */
const destinations = new Map<string, Destination>();

function destination(output: string | undefined, session: EditorSession | null): Destination {
  if (output === undefined) return { kind: session ? "library" : "disk", path: null };
  if (isUrlSource(output)) throw new DapiError("invalid-input", `The result cannot be saved to a URL (${output}).`);
  if (/[\\/]$/.test(output)) throw new DapiError("invalid-input", `The output is the file to save, not a folder (got "${output}").`);
  if (isAbsoluteSource(output)) return { kind: "disk", path: output };
  if (!session) {
    throw new DapiError(
      "no-project",
      `"${output}" is a library path, which needs an open project — open one, or pass an absolute path to save the result elsewhere.`,
    );
  }
  return { kind: "library", path: output.replace(/^\.\//, "") };
}

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

/**
 * Puts `blob` into the library at `path`. A file the project made already
 * there is written over and taken in again at the same path, so everything
 * naming it shows the new one; a linked file of the user's is never written
 * over, and the new one gets a free name next to it instead.
 */
async function storeAt(library: AssetLibrary, path: string, blob: Blob): Promise<Asset> {
  const existing = library.get(path);
  if (existing && isProjectSource(existing.source)) {
    await library.fs.write(existing.source, blob);
    return library.relink(existing, existing.source);
  }
  const slash = path.lastIndexOf("/");
  return library.store(blob, { folder: slash < 0 ? "" : path.slice(0, slash), name: path.slice(slash + 1) });
}

// ── The API ──────────────────────────────────────────────────

async function requireSignIn(): Promise<void> {
  const session = await supabase?.auth.getSession();
  if (!session?.data.session) {
    throw new DapiError("sign-in-required", "Generating needs a Diffusion Studio account — sign in to the app first.");
  }
}

const API_ERRORS: Record<string, DapiErrorCode> = {
  BAD_REQUEST: "invalid-input",
  UNAUTHORIZED: "sign-in-required",
  NOT_FOUND: "not-found",
  CONFLICT: "busy",
};

