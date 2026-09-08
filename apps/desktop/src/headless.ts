/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Whether an agent has connected since launch. Once one has, the UI steps
// back: file writes from tools are not echoed as edits, and the window may
// stay hidden. Set by the MCP server on its first connection; read wherever
// behaviour depends on who is driving.

let headless = false;

export function isHeadless(): boolean {
  return headless;
}

export function enableHeadless(): void {
  headless = true;
}
