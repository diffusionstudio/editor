/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";
import { AssetPath, Bytes, checkWindow } from "../schemas";
import { NonNegativeTime, TIME_FORMS } from "../time";

/** The SAM 2.1 sizes the app offers, fastest first: the ids of its model catalogue (`SAM2_MODELS`). */
export const SEGMENT_MODELS = ["tiny", "small", "base-plus", "large"] as const;

/** A tracked frame the model rates below this is reported as weak. */
export const WEAK_IOU = 0.5;

const Unit = z.number().min(0).max(1);

const Point = z.object({ x: Unit, y: Unit });

/** A span of source time, `[start, end)` in seconds. */
const Range = z.tuple([z.number(), z.number()]);

const Bounds = z.tuple([z.number(), z.number(), z.number(), z.number()]);

/** What the call found, the same whether the server or the renderer writes the files. */
const found = {
  model: z.enum(SEGMENT_MODELS),
  frameRate: z.number().describe("frames per second the mask holds: the project's, or the file's own with no project open"),
  start: z.number().describe("source time of the first masked frame, in seconds: the `sourceIn` of a `<mask>` naming the file"),
  end: z.number().describe("source time just past the last masked frame, in seconds"),
  frames: z.int().describe("frames masked"),
  bbox: Bounds.nullable().describe(
    "on the prompted frame, the object's bounds as [x0, y0, x1, y1] in 0..1 of the frame; null when nothing was segmented",
  ),
  area: z.number().describe("on the prompted frame, the share of the frame the object covers, 0..1"),
  score: z.number().describe("on the prompted frame, the model's object score: at or below 0 it sees no object there"),
  iou: z.number().describe("on the prompted frame, the model's estimate of the mask's quality, 0..1"),
  lost: z
    .array(Range)
    .describe("source-time spans, [start, end) in seconds, where no object was found: occluded, out of frame, or lost by the track"),
  weak: z.array(Range).describe(`source-time spans, [start, end) in seconds, where the model rated its mask below ${WEAK_IOU}`),
};

export const mediaSegment = defineTool({
  name: "media_segment",
  title: "Segment object",
  description:
    "Segment an object in a video with SAM 2.1 and track it through the footage, writing a mask file (`.mask`) that a `<mask src>` names: the file the editor's object mask tool makes (local model on the GPU, no credits). " +
    "Prompt the object on the frame at `time` with `points` on it, `exclude` points off it, and/or a `box` around it, all in 0..1 of the frame (x right, y down). " +
    "`preview: true` segments that frame alone and writes only an image: the frame with the mask tinted and outlined, the prompts drawn, and a 0.1 grid to read coordinates off. Refine the prompts with previews (fast once the frame is encoded), then make the same call without `preview` to track. " +
    "Tracking covers `start` to `end`, the whole file by default, at roughly 0.25 s a frame with the tiny model and several times that with the larger ones, so pass the span the clip actually plays. " +
    "Returns the mask's path (and its library path when it went into the project), a contact sheet of tracked frames, and the spans where the object was lost or the mask is weak. The first use of a model downloads it (83 MB for tiny, up to 475 MB for large).",
  input: z
    .object({
      path: AssetPath,
      time: NonNegativeTime.describe(`the frame the prompts are placed on, in source time — ${TIME_FORMS}`),
      points: z.array(Point).optional().describe("points on the object, each { x, y } in 0..1 of the frame"),
      exclude: z
        .array(Point)
        .optional()
        .describe("points on what is not the object, to take it out of the mask; each { x, y } in 0..1 of the frame"),
      box: Bounds.optional().describe("a box around the object, [x0, y0, x1, y1] in 0..1 of the frame"),
      preview: z
        .boolean()
        .optional()
        .describe("segment only the frame at `time` and write no mask: for checking a prompt before tracking"),
      start: NonNegativeTime.optional().describe(`start of the span to track — ${TIME_FORMS} (default: 0)`),
      end: NonNegativeTime.optional().describe(`end of the span to track — ${TIME_FORMS} (default: the file's end)`),
      model: z
        .enum(SEGMENT_MODELS)
        .optional()
        .describe("SAM 2.1 size: tiny (fastest), small, base-plus, or large (slowest; finest edges, best on small objects) (default: tiny)"),
      output: z
        .string()
        .optional()
        .describe(
          "where the mask file goes: a library path like `masks/skater.mask` (needs an open project; a mask already there is replaced, so every `<mask>` naming it follows) or an absolute file path (default: `masks/<video>/Tracking <n>.mask` in the library with a project open, else a fresh file under the system temp dir)",
        ),
    })
    .superRefine((value, ctx) => {
      if (!value.points?.length && !value.box) {
        ctx.addIssue({ code: "custom", path: ["points"], message: "prompt the object with points on it or a box around it" });
      }
      if (value.box && (value.box[0] >= value.box[2] || value.box[1] >= value.box[3])) {
        ctx.addIssue({ code: "custom", path: ["box"], message: "a box is [x0, y0, x1, y1] in 0..1 of the frame, with x0 < x1 and y0 < y1" });
      }
      if (value.box?.some((bound) => bound < 0 || bound > 1)) {
        ctx.addIssue({ code: "custom", path: ["box"], message: "a box's bounds are in 0..1 of the frame" });
      }
      if (value.preview) {
        for (const key of ["start", "end", "output"] as const) {
          if (value[key] !== undefined) {
            ctx.addIssue({ code: "custom", path: [key], message: `a preview segments one frame and writes no mask; ${key} applies to tracking only` });
          }
        }
        return;
      }
      checkWindow(value, ctx);
      if (value.start !== undefined && value.time < value.start) {
        ctx.addIssue({ code: "custom", path: ["time"], message: `time (${value.time}s) is before start (${value.start}s); the prompted frame must be tracked` });
      }
      if (value.end !== undefined && value.time >= value.end) {
        ctx.addIssue({ code: "custom", path: ["time"], message: `time (${value.time}s) is not before end (${value.end}s); the prompted frame must be tracked` });
      }
    }),
  output: z.object({
    image: z
      .string()
      .describe("absolute path of the PNG: the prompted frame with its mask on a preview, a contact sheet of tracked frames otherwise"),
    path: z.string().optional().describe("absolute path of the mask file; absent on a preview"),
    src: z.string().optional().describe("the mask's library path, for `<mask src>`; present when it was written into the project's library"),
    ...found,
  }),
  result: z.object({
    png: Bytes,
    /** The mask file, for the server to write where the renderer cannot: an absolute path, or the temp dir. */
    mask: Bytes.optional(),
    path: z.string().optional(),
    src: z.string().optional(),
    ...found,
  }),
  environment: "renderer",
});
