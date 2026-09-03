/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";

export const open = defineTool({
  name: "open",
  title: "Open project",
  description:
    "Open a folder as a project in the running app, creating the project files if the folder is not one yet, and show it in the editor. Returns the project's id, display name, and folder. Run this once before tools that need an open project (capture, check, export, context, and library paths in media tools).",
  input: z.object({
    dir: z.string().min(1).describe("absolute path of the project folder to open or create"),
  }),
  output: z.object({
    id: z.string().describe("package.json projectId; empty for a folder that predates ids"),
    name: z.string().describe("display name"),
    dir: z.string().describe("absolute path of the project folder"),
  }),
  runsIn: "renderer",
});
