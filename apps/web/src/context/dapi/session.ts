/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The CLI router mounts once for the app's lifetime (see ./api); what changes
// as projects open and close is this slot. The editor publishes its world and
// project here while it is mounted, and project-bound endpoints read the slot
// per request instead of closing over a world at registration time.

import { createSignal } from "solid-js";
import { assert } from "@/utils/common";

import type { Accessor } from "solid-js";
import type { World } from "@diffusionstudio/koota";

/**
 * The open project, as the editor knows it. Structural on purpose: this is
 * the slice of the project context the handlers read, without depending on
 * the Solid context it comes from.
 */
export type OpenProject = {
  dir: () => string;
};

/** What only an open project can offer: the world drawing it, and which project that is. */
export type EditorSession = { world: World; project: OpenProject };

const [session, setSession] = createSignal<EditorSession | null>(null);

/** The open project's session; null at the dashboard (and between projects). */
export const editorSession: Accessor<EditorSession | null> = session;

/** Set by the editor while a project is open; cleared on its way out. */
export const setEditorSession = setSession;

/** The session, or the failure a CLI caller can act on. */
export function requireEditorSession(): EditorSession {
  const current = session();
  assert(current, "No project open — run `dapi open <dir>` first.");
  return current;
}
