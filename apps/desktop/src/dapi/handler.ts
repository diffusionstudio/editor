/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { LogEntry, ToolArgs, ToolResult } from "@diffusionstudio/dapi";

/** The main window, as the `window` tool drives it. */
export type AppWindow = {
  /** Whether the window is out for the user. */
  visible(): boolean;
  /** Shows and focuses it, creating it when there is none. */
  show(): Promise<void>;
  /** Puts it away; the app keeps running in the background. */
  hide(): void;
};

/** What a main-process handler gets besides its arguments. */
export type MainContext = {
  /** Fires when the caller cancels or goes away. */
  signal: AbortSignal;
  /** The app's console buffer, oldest first. */
  logs(): LogEntry[];
  /** The app's version. */
  version: string;
  /** The main window. */
  window: AppWindow;
};

/** The tools that need the file system, a child process or the window itself, not a renderer. */
export type MainToolName = "logs" | "report" | "window";

export type MainHandler<N extends MainToolName> = (args: ToolArgs<N>, ctx: MainContext) => Promise<ToolResult<N>>;

export type MainHandlers = { readonly [N in MainToolName]: MainHandler<N> };
