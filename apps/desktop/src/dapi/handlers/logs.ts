/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { LogEntry, LogLevel } from "@diffusionstudio/dapi";
import type { MainHandler } from "../handler";

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warning: 2, error: 3 };

export const logs: MainHandler<"logs"> = async ({ tail, level }, ctx) => {
  let entries = ctx.logs();
  if (level !== undefined) {
    const min = LEVEL_RANK[level];
    entries = entries.filter((e) => LEVEL_RANK[e.level] >= min);
  }
  if (tail !== undefined) entries = entries.slice(-tail);
  return { entries };
};

/** One log entry as a line: local time, level, message, source. */
export function formatLogEntry(entry: LogEntry): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const d = new Date(entry.ts);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  const source = entry.source ? `  (${entry.source})` : "";
  return `${time} [${entry.level}] ${entry.message}${source}`;
}
