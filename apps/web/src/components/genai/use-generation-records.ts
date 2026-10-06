/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// How the selection was generated and what it cost. A generated asset keeps
// the id of the job it came from (`Asset.job`); the job is the API's account
// of the run — what it was asked, which "Rerun" and "Reuse" work from, and
// what it was charged.

import { createMemo, createResource } from "solid-js";
import { api } from "@/lib/api";
import { useMediaSelection } from "./selection";
import { toConfig } from "./requests";

import type { Job } from "@diffusionstudio/api-contract";
import type { GenerationConfig } from "./types";

export function useGenerationRecords() {
  const { media } = useMediaSelection();

  const jobIds = createMemo(
    () => [...new Set(media().map((entry) => entry.asset?.job).filter((id) => id !== undefined))],
    undefined,
    { equals: (a, b) => a.length === b.length && a.every((id, index) => id === b[index]) },
  );

  const [jobs] = createResource(jobIds, async (ids): Promise<Job[]> => {
    const settled = await Promise.allSettled(ids.map((id) => api.jobs.get.query({ id })));
    return settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  }, { initialValue: [] });

  const isGenerated = createMemo(() => jobIds().length > 0);
  const totalCredits = createMemo(() => jobs().reduce((sum, job) => sum + job.credits, 0));

  /** The job behind the first generated asset of the selection, once it is fetched. */
  const firstJob = (): Job | undefined => jobs()[0];

  /** The prompt box's settings for that job, when the prompt box makes such requests. */
  const firstConfig = (): GenerationConfig | undefined => {
    const job = firstJob();
    return job ? toConfig(job.request) : undefined;
  };

  return { isGenerated, totalCredits, firstJob, firstConfig };
}
