/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { mainBridge } from "@/lib/ipc";
import { MAIN_CHANNELS } from "@desktop/main-channels";

import type { ToolHandler } from "../handler";

export const screenshot: ToolHandler<"screenshot"> = () => mainBridge.call(MAIN_CHANNELS.WINDOW_CAPTURE, undefined);
