/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Building blocks several tools share. A tool file composes these; nothing
// here is a tool on its own.

import { z } from "zod";
import { NonNegativeTime } from "./time";

export const NodeId = z
  .string()
  .min(1)
  .describe("node id from the project's JSX, or `file:id` when two files use the same id");

export const SceneId = z
  .string()
  .min(1)
  .describe("scene id from the project's JSX, or `file:id` when two files use the same id");

export const AssetPath = z
  .string()
  .min(1)
  .describe(
    "absolute file path or URL (works with or without an open project), or a library path like `b-roll/clip.mp4` (needs an open project)",
  );

/** Beyond this the cells get too small to be worth the tokens; use `media_filmstrip`. */
export const MAX_FRAMES_PER_SHEET = 12;

/**
 * Raw bytes as a handler produces them. How they travel is the transport's
 * business: base64 on a JSON wire, structured clone over IPC, a file on disk.
 */
export const Bytes = z.custom<Uint8Array>((value) => value instanceof Uint8Array, "expected bytes (a Uint8Array)");

/**
 * One rendered image as a handler returns it: a single frame stamped with its
 * timecode, or a contact sheet stamped with the span it covers (`0f-08s10f`).
 */
export const TimecodedImage = z.object({
  timecode: z.string(),
  png: Bytes,
});

/** The same image once the server has written it to disk. */
export const ImageRef = z.object({
  timecode: z.string(),
  path: z.string().describe("absolute path of the PNG"),
});

export const outputDirField = z
  .string()
  .optional()
  .describe("absolute directory to write the PNGs into (default: a fresh directory under the system temp dir)");

/**
 * How frames are laid out: merged into contact sheets (the default) or one
 * image each. `perSheet` only means something for sheets; `checkSheetOptions`
 * rejects it otherwise, so add it to any object that spreads these fields.
 */
export const sheetFields = {
  combine: z
    .boolean()
    .default(true)
    .describe("merge the images into contact sheets of up to 12 cells, each labelled with its timecode (default); false writes one image per position"),
  perSheet: z
    .int()
    .min(1)
    .max(MAX_FRAMES_PER_SHEET)
    .optional()
    .describe("positions per contact sheet, 1-12; fewer means a larger cell each (default: as many as fit)"),
};

export function checkSheetOptions(
  value: { combine: boolean; perSheet?: number | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.perSheet !== undefined && !value.combine) {
    ctx.addIssue({
      code: "custom",
      path: ["perSheet"],
      message: "perSheet lays out contact sheets; it cannot be combined with combine: false",
    });
  }
}

/** A `[start, end)` window in seconds; both optional, and start must precede end. */
export const windowFields = {
  start: NonNegativeTime.optional(),
  end: NonNegativeTime.optional(),
};

export function checkWindow(
  value: { start?: number | undefined; end?: number | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.start !== undefined && value.end !== undefined && value.start >= value.end) {
    ctx.addIssue({
      code: "custom",
      path: ["end"],
      message: `start (${value.start}s) must be less than end (${value.end}s)`,
    });
  }
}

export const LogLevel = z.enum(["debug", "info", "warning", "error"]);

export const LogEntry = z.object({
  ts: z.number().describe("unix time, milliseconds"),
  level: LogLevel,
  message: z.string(),
  source: z.string().describe("file:line the entry came from, or empty"),
});
