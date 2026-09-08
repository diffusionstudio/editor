/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";
import { AssetPath, Bytes, checkWindow, windowFields } from "../schemas";

/** The window and scale that filmstrip and waveform share. */
export const previewFields = {
  ...windowFields,
  output: z.string().optional().describe("absolute path to write the PNG to (default: a fresh file under the system temp dir)"),
  scale: z
    .number()
    .positive()
    .optional()
    .describe("scale factor for the thumbnails; smaller fits more rows and columns, larger fits fewer (default: 1)"),
};

export const mediaFilmstrip = defineTool({
  name: "media_filmstrip",
  title: "Filmstrip preview",
  description:
    "Render a grid of thumbnails sampled across the timeline to a PNG (local render, no credits), each row stamped with an HH:MM:SS:FF ruler. A fast, token-efficient video track preview; narrow the window to zoom into a region of interest. Video only (use media_waveform for audio).",
  input: z.object({ path: AssetPath, ...previewFields }).superRefine(checkWindow),
  output: z.looseObject({ path: z.string().describe("absolute path of the PNG") }),
  result: z.looseObject({ png: Bytes }),
  runsIn: "renderer",
});
