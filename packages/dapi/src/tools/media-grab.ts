/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";
import { AssetPath, checkSheetOptions, checkWindow, sheetFields, TimecodedImage, windowFields } from "../schemas";
import { Time } from "../time";

export const FrameQuality = z.enum(["small", "medium", "large", "fullres"]);

/** Guardrail against accidentally decoding a huge number of frames; `uncapped` lifts it. */
export const FRAME_CAP = 100;

export const mediaGrab = defineTool({
  name: "media_grab",
  title: "Grab frames",
  description:
    "Decode frames of a video file and write them as PNGs (local render, no credits). By default the frames are merged into contact sheets: up to 12 per image, each cell labelled with its timecode (`08s10f`, zero segments dropped) and drawn as large as fits, so a handful of frames arrives as one high-resolution picture instead of a directory to open one by one (combine: false writes a PNG per frame). Grabs the asset's own pixels, unlike capture which renders the composited node. The recommended tool for understanding a video at the frame level; past ~12 frames prefer media_filmstrip.",
  input: z
    .object({
      path: AssetPath,
      times: z
        .array(Time)
        .optional()
        .describe(
          'timestamps to grab — seconds ("1.5"), frames ("45f"), or "MM:SS"; negatives count back from the end, so -1 is one second before the end and -1f one frame before it (default: [0])',
        ),
      count: z
        .int()
        .min(1)
        .optional()
        .describe("instead of times, grab this many frames evenly spaced across the clip (or across the start/end window)"),
      auto: z
        .boolean()
        .optional()
        .describe(
          "scan the clip at 2fps and keep a frame each time the footage settles into a new visual state (transitions are waited out, so picks stay sharp); returns at most count frames (default cap: 30), static footage like screen recordings returns far fewer; requires WebGPU",
        ),
      ...windowFields,
      quality: FrameQuality.optional().describe(
        "frame resolution: small (384x384), medium (768x768), large (1536x1536), or fullres (native); default: as large as the sheet cell allows, or small with combine: false",
      ),
      ...sheetFields,
      uncapped: z
        .boolean()
        .optional()
        .describe(`lift the ${FRAME_CAP}-frame safety cap (grabbing many frames is slow and token-heavy)`),
    })
    .superRefine((value, ctx) => {
      if (value.times !== undefined && value.count !== undefined) {
        ctx.addIssue({ code: "custom", path: ["count"], message: "pass either times or count, not both" });
      }
      if (value.auto && value.times !== undefined) {
        ctx.addIssue({ code: "custom", path: ["times"], message: "auto picks its own timestamps; it cannot be combined with times" });
      }
      const windowed = value.start !== undefined || value.end !== undefined;
      if (windowed && value.count === undefined && !value.auto) {
        ctx.addIssue({ code: "custom", path: ["start"], message: "start and end only apply together with count or auto" });
      }
      checkWindow(value, ctx);
      const requested = value.count ?? value.times?.length ?? 1;
      if (!value.uncapped && requested > FRAME_CAP) {
        ctx.addIssue({
          code: "custom",
          path: [value.count !== undefined ? "count" : "times"],
          message: `grabbing ${requested} frames exceeds the ${FRAME_CAP}-frame cap; pass uncapped: true to override`,
        });
      }
      checkSheetOptions(value, ctx);
    }),
  output: z.array(TimecodedImage),
  runsIn: "renderer",
});
