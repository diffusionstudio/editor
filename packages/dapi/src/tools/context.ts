/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";
import { Bytes } from "../schemas";
import { segmentFound, segmentSpan } from "./media-segment";

const GenerationRow = z.object({
  element: z
    .string()
    .nullable()
    .describe("the element's source stamp, `<file>:<key or position>`; null for an entity no element produced"),
  name: z.string().nullable(),
  state: z.enum(["generating", "failed", "done"]),
  error: z.string().optional().describe("what the generation failed with, on failed rows"),
  asset: z
    .string()
    .optional()
    .describe("the library path the generation landed as, on done rows — ready for media_probe and its siblings"),
});

const maskRow = {
  id: z.string().describe("the track's id, the same across polls"),
  src: z.string().describe("the mask's library path, for `<mask src>`: the file is there once the row is done"),
  video: z.string().describe("the footage tracked, as media_segment was given it"),
  state: z.enum(["loading", "tracking", "done", "failed"]).describe(
    "`loading` while the model loads or another track has it, `tracking` while frames are masked, then `done` or `failed`",
  ),
  progress: z
    .number()
    .nullable()
    .describe("0..1: the model's download while loading (null when there is none to report), the frames masked while tracking; 1 once done"),
  error: z.string().optional().describe("what the track failed with, on failed rows"),
  ...segmentSpan,
  ...z.object(segmentFound).partial().shape,
};

const MaskRow = z.object({
  ...maskRow,
  image: z.string().optional().describe("absolute path of a contact sheet of tracked frames with their masks, on done rows"),
});

/**
 * What the project's source cannot say: the JSX already holds the scenes,
 * the selection, and the work area, so the report is only the folders, the
 * playhead, the fonts actually registered, and where generations and
 * background mask tracks stand.
 */
export const context = defineTool({
  name: "context",
  title: "App context",
  description:
    "Report the current app context: the folder new projects are created in (always reported), the folder of the project the app has open (null when none is), where its playhead sits in seconds, the registered font families, where its `generate.*` declarations stand, and the progress of `media_segment` tracks running in the background. Poll it to wait for generations and tracks without blocking.",
  input: z.object({}),
  output: z.object({
    rootDir: z.string().nullable().describe("folder new projects are created in; null until one has been chosen"),
    projectDir: z.string().nullable().describe("absolute path of the open project; null when none is open"),
    currentTime: z
      .number()
      .nullable()
      .describe("playhead in seconds, the unit the source places clips in; null when no scene is active or no project is open"),
    fontFamilies: z
      .array(z.string())
      .describe("families registered in the world drawing the project; the editor default is always among them"),
    generations: z.array(GenerationRow),
    masks: z.array(MaskRow).describe("media_segment tracks started while this project is open, oldest first"),
  }),
  result: z.object({
    rootDir: z.string().nullable(),
    projectDir: z.string().nullable(),
    currentTime: z.number().nullable(),
    fontFamilies: z.array(z.string()),
    generations: z.array(GenerationRow),
    /** A done row's contact sheet comes as bytes, which the server writes to a file once per track. */
    masks: z.array(z.object({ ...maskRow, png: Bytes.optional() })),
  }),
  environment: "renderer",
});

export type GenerationRow = z.output<typeof GenerationRow>;
export type MaskRow = z.output<typeof MaskRow>;
