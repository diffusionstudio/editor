/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";
import { AssetPath } from "../schemas";

export const TranscriptWord = z.object({
  text: z.string(),
  start: z.number().describe("seconds"),
  end: z.number().describe("seconds"),
});

export const TranscriptSegment = z.object({
  text: z.string(),
  words: z.array(TranscriptWord),
});

export const mediaTranscribe = defineTool({
  name: "media_transcribe",
  title: "Transcribe speech",
  description:
    "Transcribe the speech in a video or audio file and return the timed transcript, with word-level start/end times in seconds. Commonly useful for footage with speakers (talking head, interview), where the word times let you cut on a line. A transcript marks only speech; the gaps are not necessarily silent (music, score, applause).",
  input: z.object({ path: AssetPath }),
  output: z.object({ segments: z.array(TranscriptSegment) }),
  runsIn: "renderer",
});
