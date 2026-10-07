/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { jobFailure, runJob } from "@/lib/jobs";
import { sha256, uploadFile } from "@/lib/uploads";
import { requireAssetType, resolveAsset } from "../lib/assets";
import { audioFile } from "../lib/audio";
import { apiError, requireSignIn } from "../lib/remote";

import type { Transcript } from "@diffusionstudio/api-contract";
import type { ToolHandler } from "../handler";

/** Transcripts by the sha256 of the audio sent, for this app session: asking again costs nothing. */
const transcripts = new Map<string, Promise<Transcript>>();

/** The asset's audio, transcribed on the API; the main process writes the transcript to its file. */
export const mediaTranscribe: ToolHandler<"media_transcribe"> = async ({ path }, ctx) => {
  const asset = await resolveAsset(ctx, path);
  requireAssetType(asset, ["AUDIO", "VIDEO"], "a video or audio asset");
  await requireSignIn();

  const audio = await audioFile(asset);
  const key = await sha256(audio);
  let transcript = transcripts.get(key);
  if (!transcript) {
    transcript = transcribe(audio, ctx.signal);
    transcripts.set(key, transcript);
    transcript.catch(() => transcripts.delete(key));
  }

  const segments = await transcript;
  if (!segments.some((segment) => segment.words.length > 0)) {
    throw new Error("No speech detected: the audio does not appear to contain recognizable speech.");
  }
  return { segments };
};

/** `audio` uploaded and transcribed; aborting `signal` cancels the job. */
async function transcribe(audio: Blob, signal: AbortSignal): Promise<Transcript> {
  try {
    const job = await runJob({ model: "universal-3.5-pro", audio: await uploadFile(audio) }, () => {}, signal);
    if (job.status !== "succeeded") throw new Error(jobFailure(job));

    const [file] = job.assets;
    if (!file) throw new Error("The transcription returned nothing.");
    const response = await fetch(file.url, { signal });
    if (!response.ok) throw new Error(`Could not download the transcript (${response.status})`);
    return await response.json() as Transcript;
  } catch (error) {
    throw apiError(error);
  }
}
