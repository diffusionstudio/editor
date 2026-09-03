/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";
import { AssetPath, checkWindow, windowFields } from "../schemas";

export const mediaListen = defineTool({
  name: "media_listen",
  title: "Listen to audio",
  description:
    "Prompt a multimodal model for a semantic analysis of an audio track and return its answer. Shines on audio semantics (the name of the music playing, who is speaking, the spoken content with second-granularity timestamps). Accepts an audio file or a video; by default only the audio track is analyzed. Needs a signed-in account.",
  input: z
    .object({
      path: AssetPath,
      prompt: z.string().optional().describe("question or instruction to guide the analysis"),
      start: windowFields.start.describe(
        "start of the segment to analyze (default: 0); timestamps in the analysis are relative to this point",
      ),
      end: windowFields.end.describe("end of the segment to analyze (default: media duration)"),
      stripVideo: z
        .boolean()
        .optional()
        .describe(
          "for a video asset, analyze the audio track only (default); false keeps the video so the model also reads what is on screen (expensive: uploads the full video)",
        ),
    })
    .superRefine(checkWindow),
  output: z.object({
    result: z.string().optional(),
    start: z.number().optional(),
    end: z.number().optional(),
  }),
  runsIn: "renderer",
});
