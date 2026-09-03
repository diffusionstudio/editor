/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The tool handlers register once for the app's lifetime (see ./api); what
// changes as projects open and close is this slot. The editor publishes its
// world and project here while it is mounted, and project-bound handlers read
// the slot per request instead of closing over a world at registration time.

import { createSignal } from "solid-js";
import { DapiError } from "@diffusionstudio/dapi";

import type { Accessor } from "solid-js";
import type { World } from "koota";
import type { Engine } from "@/engine";

/**
 * The open project, as the editor knows it. Structural on purpose: this is
 * the slice of the project context the handlers read, without depending on
 * the Solid context it comes from.
 */
export type OpenProject = {
  dir: () => string;
};

/** What only an open project can offer: the world drawing it, the engine running it, and which project that is. */
export type EditorSession = { world: World; project: OpenProject; engine: Engine };

const [session, setSession] = createSignal<EditorSession | null>(null);

/** The open project's session; null at the dashboard (and between projects). */
export const editorSession: Accessor<EditorSession | null> = session;

/** Set by the editor while a project is open; cleared on its way out. */
export const setEditorSession = setSession;

/** The session, or the failure a caller can act on. */
export function requireEditorSession(): EditorSession {
  const current = session();
  if (!current) throw new DapiError("no-project", "No project open — open one first (`dapi open <dir>`).");
  return current;
}
