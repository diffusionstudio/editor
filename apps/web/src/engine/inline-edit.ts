/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from 'solid-js';

/** Whether the on-canvas text editor is open for the selected text/caption. */
const [inlineEditing, setInlineEditing] = createSignal(false);
export { inlineEditing, setInlineEditing };
