/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";
import { checkSheetOptions, SceneId, sheetFields, TimecodedImage } from "../schemas";

export const capture = defineTool({
  name: "capture",
  title: "Capture frames",
  description:
    "Render single frames of a scene to PNGs — each frame is the frame an export of that scene would encode, drawn offscreen at the scene's own size. By default the positions are merged into contact sheets: up to 12 per image, each cell labelled with its timecode (`08s10f`, zero segments dropped) and rendered as large as fits, so a few positions arrive as one high-resolution picture instead of a directory to open one by one (combine: false writes a PNG per position, at 720p height). The tool for checking composition (\"what plays at time T\": layout, overlaps, text, timing) and for verifying frames before an export. Scenes only — a single element renders inside its scene, so capture the scene at the times it plays. For a video asset's own full-resolution pixels use media_grab.",
  input: z
    .object({
      id: SceneId,
      frames: z
        .array(z.int().nonnegative())
        .optional()
        .describe("positions to capture as frame numbers relative to the export's first frame, the workarea's start (default: [0])"),
      ...sheetFields,
    })
    .superRefine(checkSheetOptions),
  output: z.array(TimecodedImage),
  runsIn: "renderer",
});
