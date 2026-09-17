/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";

/** Trailing app log entries the `dapi report` command reads and attaches by default. */
export const ISSUE_LOG_TAIL = 50;

export const report = defineTool({
  name: "report",
  title: "Report a bug",
  description:
    "Report a bug in dapi or the app itself. Files a GitHub issue on diffusionstudio/editor with diagnostics attached (dapi version, platform, and whatever log lines you pass) and returns its URL. Submits immediately and publicly through the gh CLI, which must be installed and authenticated; there is no review step, so only report real defects, and read any logs with the logs tool before attaching them so you know what you are publishing.",
  input: z.object({
    title: z.string().min(1).describe("one-line summary of the problem"),
    body: z.string().optional().describe("what happened, in markdown: expected vs actual, and anything the diagnostics won't show"),
    commands: z.array(z.string()).optional().describe("the dapi commands or tool calls that reproduce it, in order"),
    logs: z.array(z.string()).optional().describe("app log lines to attach, as read with the logs tool; omit to attach none"),
  }),
  output: z.object({ url: z.string() }),
  environment: "main",
});
