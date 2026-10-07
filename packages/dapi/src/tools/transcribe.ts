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
  speaker: z.string().optional().describe("speaker label (A, B, …) when speakers are told apart"),
  words: z.array(TranscriptWord),
});

export const transcribe = defineTool({
  name: "transcribe",
  title: "Transcribe speech",
  description:
    "Transcribe the speech in a video or audio file and write the timed transcript to a JSON file, `{ segments: [{ text, speaker?, words: [{ text, start, end }] }] }` with word-level times in seconds and speakers labelled A, B, … when told apart; returns the file's path and its segment and word counts. Search the file for the passage you need (grep, jq) rather than reading it whole: a long recording's word timings run to tens of thousands of tokens. Commonly useful for footage with speakers (talking head, interview), where the word times let you cut on a line. A transcript marks only speech; the gaps are not necessarily silent (music, score, applause).",
  input: z.object({
    path: AssetPath,
    output: z.string().optional().describe("absolute path to write the transcript JSON to (default: a fresh file under the system temp dir)"),
  }),
  output: z.object({
    path: z.string().describe("absolute path of the transcript JSON"),
    segments: z.int().describe("segments in the transcript"),
    words: z.int().describe("words across all segments"),
  }),
  result: z.object({ segments: z.array(TranscriptSegment) }),
  environment: "renderer",
});
