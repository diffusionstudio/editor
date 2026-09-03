/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";

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

/**
 * What the project's source cannot say: the JSX already holds the scenes,
 * the selection, and the work area, so the report is only the folders, the
 * playhead, the fonts actually registered, and where generations stand.
 */
export const context = defineTool({
  name: "context",
  title: "App context",
  description:
    "Report the current app context: the application root folder (always reported), the folder of the project the app has open (null when none is), where its playhead sits in seconds, the registered font families, and where its `generate.*` declarations stand. Poll it to wait for generations without blocking.",
  input: z.object({}),
  output: z.object({
    rootDir: z.string().nullable().describe("folder projects live under; null until one has been chosen"),
    projectDir: z.string().nullable().describe("absolute path of the open project; null when none is open"),
    currentTime: z
      .number()
      .nullable()
      .describe("playhead in seconds, the unit the source places clips in; null when no scene is active or no project is open"),
    fontFamilies: z
      .array(z.string())
      .describe("families registered in the world drawing the project; the editor default is always among them"),
    generations: z.array(GenerationRow),
  }),
  runsIn: "renderer",
});

export type GenerationRow = z.output<typeof GenerationRow>;
