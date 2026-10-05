/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Generation jobs on the API: everything that produces a file is one
 * `generate` call that answers with a job right away, which is then polled
 * (`jobs.get`) until it ends.
 */

import { api } from "./api";

import type { GenerateRequestInput, Job } from "@diffusionstudio/api-contract";

/** How often a running job is asked for its state. */
const POLL_INTERVAL = 1000;

/** How many polls in a row may fail before the job is given up on. */
const MAX_FAILURES = 5;

export const isTerminal = (job: Job): boolean =>
  job.status === "succeeded" || job.status === "failed" || job.status === "canceled";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Starts a job for `request` and follows it to its end. `onUpdate` hears
 * every state the job is seen in, the first one included. Resolves with the
 * job as it ended — failed and canceled jobs included, which say why in
 * `error`; rejects only when the job could not be started or followed.
 */
export async function runJob(request: GenerateRequestInput, onUpdate: (job: Job) => void): Promise<Job> {
  let job = await api.generate.mutate({ request, idempotencyKey: crypto.randomUUID() });
  onUpdate(job);

  let failures = 0;
  while (!isTerminal(job)) {
    await sleep(POLL_INTERVAL);
    try {
      job = await api.jobs.get.query({ id: job.id });
      failures = 0;
      onUpdate(job);
    } catch (error) {
      if (++failures >= MAX_FAILURES) {
        throw error;
      }
    }
  }
  return job;
}

/** Why a job did not succeed, in a sentence for the user. */
export function jobFailure(job: Job): string {
  if (job.status === "canceled") return "The generation was canceled.";
  return job.error?.message || "The generation failed.";
}
