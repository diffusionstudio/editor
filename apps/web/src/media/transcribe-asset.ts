/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trpc } from "@/lib/trpc";
import { uploadBlob } from "@/lib/uploads";
import { mainBridge } from "@/lib/ipc";
import { MAIN_CHANNELS } from "@desktop/main-channels";
import { transcodeForTranscription } from "@diffusionstudio/runtime";
import type { Asset } from "@diffusionstudio/assets";
import type { Transcript } from "@diffusionstudio/runtime/media/autocut";
import type { TranscriptSegment } from "@diffusionstudio/cli/channels";

const transcriptCache = new Map<string, TranscriptSegment[]>();

function isCloudAuthError(message: string): boolean {
  return /missing authorization token|unauthorized|not authenticated|authentication required|\b401\b|user not found/i.test(
    message,
  );
}

/** Cloud STT when signed in; local whisper in the desktop app when not. */
export async function transcribeAsset(asset: Asset, projectDir: string | undefined): Promise<Transcript> {
  let segments = transcriptCache.get(asset.id);
  if (segments) return { segments };

  try {
    const audioFile = await transcodeForTranscription(asset);
    const fileRef = await uploadBlob(audioFile, crypto.randomUUID());
    if (!fileRef) throw new Error("Failed to upload asset for transcription.");

    ({ results: segments } = await trpc.transcribe.mutate({ audio: fileRef }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!isCloudAuthError(msg)) throw e;

    if (!window.desktop || !projectDir) {
      throw new Error(
        "Cloud transcription requires a signed-in account. In the desktop app, install openai-whisper for offline transcription.",
      );
    }

    const local = await mainBridge.call(MAIN_CHANNELS.MEDIA_TRANSCRIBE_LOCAL, {
      dir: projectDir,
      source: asset.source,
    });
    segments = (local as { segments: TranscriptSegment[] }).segments;
  }

  if (!segments.length || segments.every((s) => s.words.length === 0)) {
    return { segments: [] };
  }

  transcriptCache.set(asset.id, segments);
  return { segments };
}
