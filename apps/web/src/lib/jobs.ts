/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Generation jobs on the API: everything that produces a file is one
 * `generate` call that answers with a job right away, followed to its end
 * through `jobs.watch`. The stream closes when the job ends, and every few
 * minutes on the server's side regardless; reopening it hands back the
 * current state first, so a reconnect misses nothing.
 */

import { api } from "./api";

import type { GenerateRequestInput, Job } from "@diffusionstudio/api-contract";

/** How often a dropped watch is reopened before the job is given up on. */
const MAX_RETRIES = 5;
const RETRY_DELAY = 2000;

export const isTerminal = (job: Job): boolean =>
  job.status === "succeeded" || job.status === "failed" || job.status === "canceled";

/**
 * Starts a job for `request` and follows it to its end. `onUpdate` hears
 * every state the job passes through, the first one included. Resolves with
 * the job as it ended — failed and canceled jobs included, which say why in
 * `error`; rejects only when the job could not be started or followed.
 */
export async function runJob(request: GenerateRequestInput, onUpdate: (job: Job) => void): Promise<Job> {
  const job = await api.generate.mutate({ request, idempotencyKey: crypto.randomUUID() });
  onUpdate(job);
  return isTerminal(job) ? job : watchJob(job.id, onUpdate);
}

/** Follows job `id` until it ends. */
export function watchJob(id: string, onUpdate: (job: Job) => void): Promise<Job> {
  return new Promise((resolve, reject) => {
    let failures = 0;
    let ended = false;

    const subscribe = () => {
      const subscription = api.jobs.watch.subscribe({ id }, {
        onData: ({ data }) => {
          failures = 0;
          onUpdate(data);
          if (!isTerminal(data)) return;
          ended = true;
          subscription.unsubscribe();
          resolve(data);
        },
        onError: (error) => {
          if (++failures > MAX_RETRIES) reject(error);
          else setTimeout(subscribe, RETRY_DELAY * failures);
        },
        // The server closes the stream after a while; the job goes on.
        onComplete: () => {
          if (!ended) subscribe();
        },
      });
    };

    subscribe();
  });
}

/** Why a job did not succeed, in a sentence for the user. */
export function jobFailure(job: Job): string {
  if (job.status === "canceled") return "The generation was canceled.";
  return job.error?.message || "The generation failed.";
}
