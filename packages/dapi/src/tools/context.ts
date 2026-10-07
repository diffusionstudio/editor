/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";

/**
 * What the project's source cannot say: the JSX already holds the scenes,
 * the selection, and the work area, so the report is only the folders, the
 * playhead, and the fonts actually registered.
 */
export const context = defineTool({
  name: "context",
  title: "App context",
  description:
    "Report the current app context: the folder new projects are created in (always reported), the folder of the project the app has open (null when none is), where its playhead sits in seconds, and the registered font families.",
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
  }),
  environment: "renderer",
});
