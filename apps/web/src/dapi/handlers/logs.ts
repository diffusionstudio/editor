/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { mainBridge } from "@/lib/ipc";
import { MAIN_CHANNELS } from "@desktop/main-channels";

import type { LogLevel } from "@diffusionstudio/dapi";
import type { ToolHandler } from "../handler";

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warning: 2, error: 3 };

// Main owns the buffer; this is a forward until main answers tools itself.
export const logs: ToolHandler<"logs"> = async ({ tail, level }) => {
  let entries = await mainBridge.call(MAIN_CHANNELS.LOGS_GET, undefined);
  if (level !== undefined) {
    const min = LEVEL_RANK[level];
    entries = entries.filter((e) => LEVEL_RANK[e.level] >= min);
  }
  if (tail !== undefined) entries = entries.slice(-tail);
  return entries;
};
