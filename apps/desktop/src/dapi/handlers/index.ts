/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { logs } from "./logs";
import { fonts } from "./fonts";
import { fetchVideo } from "./fetch";
import { report } from "./report";

import type { MainHandlers } from "../handler";

/** Every tool main answers itself, keyed by its catalog name. */
export const mainHandlers: MainHandlers = { logs, fonts, fetch: fetchVideo, report };
