/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";
import { LogEntry, LogLevel } from "../schemas";

export const logs = defineTool({
  name: "logs",
  title: "App logs",
  description:
    "Recent console output from the running app (what the devtools console shows: page logs, worker logs, uncaught errors), oldest first. The app buffers the last 2000 entries across reloads and project switches, so this replaces relaunching with ELECTRON_ENABLE_LOGGING=1 when debugging renderer-side behavior.",
  input: z.object({
    tail: z.int().min(1).optional().describe("return only the last n entries"),
    level: LogLevel.optional().describe("minimum level to include"),
  }),
  output: z.array(LogEntry),
  runsIn: "main",
});
