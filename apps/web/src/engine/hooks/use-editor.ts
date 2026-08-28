/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useWorld } from "@diffusionstudio/koota/solid";
import { getDocumentEditor } from "../editor";

import type { DocumentEditor } from "../editor";

/** The editor of the mounted project: prop edits and element inserts, reported back to the source. */
export function useEditor(): DocumentEditor {
  return getDocumentEditor(useWorld());
}
