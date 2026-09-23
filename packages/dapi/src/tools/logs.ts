/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";
import { LogEntry, LogLevel } from "../schemas";

/** Entries returned when no tail is given. */
export const LOG_TAIL = 100;

/** Characters a message is cut at, so one dumped object or stack cannot crowd out the rest. */
export const LOG_MESSAGE_MAX = 4000;

export const logs = defineTool({
  name: "logs",
  title: "App logs",
  description: `Recent console output from the running app (what the devtools console shows: page logs, worker logs, uncaught errors), oldest first. The app buffers the last 2000 entries across reloads and project switches, so this replaces relaunching with ELECTRON_ENABLE_LOGGING=1 when debugging renderer-side behavior. Filters apply before tail; messages longer than ${LOG_MESSAGE_MAX} characters are cut. To follow work in progress, poll with since set to the last entry's ts.`,
  input: z.object({
    tail: z.int().min(1).optional().describe(`return only the last n entries (default: ${LOG_TAIL})`),
    level: LogLevel.optional().describe("minimum level to include: debug, info, warning, or error"),
    since: z.number().optional().describe("only entries logged after this unix time in milliseconds; pass the last entry's ts to get only new ones"),
    contains: z.string().min(1).optional().describe("only entries whose message contains this (case-insensitive)"),
  }),
  output: z.object({ entries: z.array(LogEntry) }),
  environment: "main",
});

/**
 * One log entry as a line: local time, level, message, source. The shape a
 * line takes wherever it is attached, so what the CLI reads back and what
 * the app would have written are the same string.
 */
export function formatLogEntry(entry: z.output<typeof LogEntry>): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const d = new Date(entry.ts);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  const source = entry.source ? `  (${entry.source})` : "";
  return `${time} [${entry.level}] ${entry.message}${source}`;
}
