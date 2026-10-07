/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What a model that runs on this machine implements to be a `generate` model.
// The runner (./jobs) owns everything a job has in common: its id and status,
// timestamps, cancelling, errors, and where its files are saved. A model
// says what the job will be and does the work.

import type { LocalModelId, LocalRequest } from "@diffusionstudio/dapi";
import type { ToolContext } from "../handler";

export interface LocalModel<M extends LocalModelId> {
  /**
   * Checks what the request's schema cannot (the file it names, times against
   * the file's length) and plans the job. Throws a `DapiError` for a request
   * it cannot run, before any job starts. Where the files go (`output`) is
   * the runner's business, not the model's.
   */
  prepare(request: LocalRequest<M>, ctx: ToolContext): Promise<LocalPlan>;
}

export type LocalPlan = {
  /** Seconds the job is expected to run for, a download of the model included. */
  etaSeconds: number;
  /** The job's `details` from the start: what is known before any work. */
  details?: Record<string, unknown>;
  /** Work quick enough that `generate` runs it before answering, with the job ended. */
  inline?: boolean;
  run(job: LocalRun): Promise<LocalOutput>;
};

export type LocalRun = {
  /** Fires when the job is canceled, the caller of an inline job goes away, or the project its files go into closes. */
  signal: AbortSignal;
  /** The model is the job's now: a queued job is running from here on. */
  start(): void;
  /** Where the job stands: its phase, how far through it (0..1, null when unknown), and the seconds left in all (null when unknown). */
  report(phase: string, progress: number | null, etaRemainingSeconds: number | null): void;
};

export type LocalOutput = {
  files: LocalFile[];
  /** Added to the job's `details`. */
  details?: Record<string, unknown>;
  /** A picture of what the job made, for the caller to look at once: shown inline, its path in `details.image`. */
  image?: Uint8Array;
};

export type LocalFile = {
  blob: Blob;
  /** The file's name, its extension the type `output` is corrected to. */
  filename: string;
  /** The library folder the file goes into when `output` names none (default: the library's root). */
  folder?: string;
};
