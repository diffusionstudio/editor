/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Accessor } from "solid-js";
import type { User } from "@supabase/supabase-js";
import type { ToolArgs, ToolName, ToolResult } from "@diffusionstudio/dapi";
import type { EditorSession } from "./session";

/**
 * What every handler gets besides its arguments. Built per call by the
 * bridge from what the app shell provides (see ./api), so handlers are plain
 * functions with no Solid in them.
 */
export type ToolContext = {
  /** The open project's session, or null at the dashboard. */
  session: Accessor<EditorSession | null>;
  /** The session, or a `no-project` error the caller can act on. */
  requireSession(): EditorSession;
  /** Fires when the caller cancels or goes away before the reply. */
  signal: AbortSignal;
  /** What only the app shell can do: navigate, and know who is signed in. */
  app: {
    openProject(dir: string): Promise<ToolResult<"open">>;
    user(): User | null;
    /** The signed-in user, or a `sign-in-required` error. */
    requireUser(): User;
  };
};

export type ToolHandler<N extends ToolName> = (args: ToolArgs<N>, ctx: ToolContext) => Promise<ToolResult<N>>;

/** The tools the renderer answers; the rest run in the main process. */
export type ServedToolName = Exclude<ToolName, "logs" | "fonts" | "fetch" | "report">;

export type Handlers = { readonly [N in ServedToolName]: ToolHandler<N> };
