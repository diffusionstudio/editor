/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { existsSync, readFileSync } from "node:fs";
import { TRPCClientError } from "@trpc/client";
import { editor, GENERATE_TIMEOUT_MS } from "./cli-client";
import {
  isCloudTranscribeUnavailable,
  localTranscribeInstallHint,
  parseTranscriptJson,
  transcribeLocal,
} from "./local-transcribe";
import type { AssetRef } from "./protocol";
import type { MediaTranscribeResult } from "./cli-channels";

const GENERATE = { context: { timeoutMs: GENERATE_TIMEOUT_MS } };

export type ResolveTranscriptOptions = {
  transcriptPath?: string;
  language?: string;
  model?: string;
};

export type TranscriptSource = "file" | "cloud" | "local";

export function cliErrorMessage(e: unknown): string {
  if (e instanceof TRPCClientError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

function offlineLocalPath(target: AssetRef): string | null {
  return existsSync(target.path) ? target.path : null;
}

/**
 * Cloud transcribe when the app session is signed in; otherwise local whisper on
 * disk paths, an explicit --transcript file, or a clear install/sign-in error.
 */
export async function resolveTranscript(
  target: AssetRef,
  opts: ResolveTranscriptOptions = {},
): Promise<{ transcript: MediaTranscribeResult; source: TranscriptSource }> {
  if (opts.transcriptPath) {
    return {
      transcript: parseTranscriptJson(readFileSync(opts.transcriptPath, "utf8")),
      source: "file",
    };
  }

  try {
    const transcript = await editor.media.transcribe.query(target, GENERATE);
    return { transcript, source: "cloud" };
  } catch (e) {
    const msg = cliErrorMessage(e);
    if (/no speech detected/i.test(msg)) {
      return { transcript: { segments: [] }, source: "cloud" };
    }
    if (!isCloudTranscribeUnavailable(msg)) throw e;

    const localPath = offlineLocalPath(target);
    if (!localPath) {
      throw new Error(
        "Cloud transcription requires a signed-in Diffusion Studio account. " +
          "For offline use, pass a local file path (not a library path), or provide --transcript. " +
          localTranscribeInstallHint(),
      );
    }

    console.error("Cloud transcription unavailable; using local speech recognition.");
    const transcript = await transcribeLocal(localPath, {
      language: opts.language,
      model: opts.model,
      timeoutMs: GENERATE_TIMEOUT_MS,
    });
    return { transcript, source: "local" };
  }
}
