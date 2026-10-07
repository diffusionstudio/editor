/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { DapiError } from "@diffusionstudio/dapi";

import { jobFailure, runJob } from "@/lib/jobs";
import { uploadFile } from "@/lib/uploads";
import { requireAssetType, resolveAsset } from "../lib/assets";
import { audioFile } from "../lib/audio";
import { apiError, requireSignIn } from "../lib/remote";

import type { ToolHandler } from "../handler";

/** The asset's audio, or a window of it, analyzed on the API; times in the answer count from `start`, echoed with `end` when a window was given. */
export const mediaListen: ToolHandler<"media_listen"> = async ({ path, prompt, start, end }, ctx) => {
  const asset = await resolveAsset(ctx, path);
  requireAssetType(asset, ["AUDIO", "VIDEO"], "a video or audio asset");

  const windowed = start !== undefined || end !== undefined;
  const from = start ?? 0;
  const to = Math.min(end ?? asset.duration, asset.duration);
  if (windowed && from >= to) {
    throw new DapiError("invalid-input", `The window is empty: start (${from.toFixed(2)}s) is at or past the end (${to.toFixed(2)}s).`);
  }
  await requireSignIn();

  try {
    const media = await uploadFile(windowed ? await audioFile(asset, from, to) : await audioFile(asset));
    const job = await runJob({ model: "gemini-3.5-flash", media, prompt }, () => {}, ctx.signal);
    if (job.status !== "succeeded") throw new Error(jobFailure(job));

    const [file] = job.assets;
    if (!file) throw new Error("The analysis returned nothing.");
    const response = await fetch(file.url, { signal: ctx.signal });
    if (!response.ok) throw new Error(`Could not download the analysis (${response.status})`);
    const result = (await response.text()).trim();
    return windowed ? { result, start: from, end: to } : { result };
  } catch (error) {
    throw apiError(error);
  }
};
