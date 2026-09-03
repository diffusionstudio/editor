/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { LogEntry, ToolArgs, ToolResult } from "@diffusionstudio/dapi";

/** What a main-process handler gets besides its arguments. */
export type MainContext = {
  /** Fires when the caller cancels or goes away. */
  signal: AbortSignal;
  /** The app's console buffer, oldest first. */
  logs(): LogEntry[];
  /** The app's version. */
  version: string;
};

/** The tools that need the file system or a child process, not a window. */
export type MainToolName = "logs" | "fonts" | "fetch" | "report";

export type MainHandler<N extends MainToolName> = (args: ToolArgs<N>, ctx: MainContext) => Promise<ToolResult<N>>;

export type MainHandlers = { readonly [N in MainToolName]: MainHandler<N> };
