/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What `shell.openExternal` is allowed to receive. The renderer sends this
// channel whatever link a person clicked, and in the chat that includes the
// ones the assistant wrote. A relative link has no scheme for the sanitizer
// to reject, and it resolves against the renderer's own base — `file://` in
// a packaged build — so `[x](../../payload.exe)` reaches the handler as a
// path on disk that the shell would open. Only the schemes a link in the app
// can legitimately need get through.

const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:", "mailto:"]);

/** The URL to hand the shell, or null when it is not one we open. */
export function externalUrl(url: string): string | null {
  let protocol: string;
  try {
    ({ protocol } = new URL(url));
  } catch {
    return null; // Not a URL at all.
  }
  return ALLOWED_PROTOCOLS.has(protocol) ? url : null;
}
