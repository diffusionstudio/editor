/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { mainBridge } from "@/lib/ipc";
import { MAIN_CHANNELS } from "@desktop/main-channels";
import type { LogsRequest, LogLevel } from "@diffusionstudio/dapi";

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warning: 2, error: 3 };

export function handleLogs() {
  return async (req: LogsRequest) => {
    let entries = await mainBridge.call(MAIN_CHANNELS.LOGS_GET, undefined);
    if (req.level !== undefined) {
      const min = LEVEL_RANK[req.level];
      entries = entries.filter((e) => LEVEL_RANK[e.level] >= min);
    }
    if (req.tail !== undefined) entries = entries.slice(-req.tail);
    return entries;
  };
}
