/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";

/** Trailing app log entries attached to an issue by default. */
export const ISSUE_LOG_TAIL = 50;

export const report = defineTool({
  name: "report",
  title: "Report a bug",
  description:
    "Report a bug in dapi or the app itself. Files a GitHub issue on diffusionstudio/editor with diagnostics attached (dapi version, platform, recent app logs) and returns its URL. Submits immediately and publicly through the gh CLI, which must be installed and authenticated; there is no review step, so only report real defects and check the attached logs for anything private.",
  input: z.object({
    title: z.string().min(1).describe("one-line summary of the problem"),
    body: z.string().optional().describe("what happened, in markdown: expected vs actual, and anything the diagnostics won't show"),
    commands: z.array(z.string()).optional().describe("the dapi commands or tool calls that reproduce it, in order"),
    logs: z.int().min(0).optional().describe(`trailing app log entries to attach (0 to omit; default: ${ISSUE_LOG_TAIL})`),
  }),
  output: z.object({ url: z.string() }),
  runsIn: "main",
});
