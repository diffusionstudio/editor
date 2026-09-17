/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Quoting for the one command that runs as root. `do shell script … with
// administrator privileges` takes a shell line inside an AppleScript string,
// so a path crosses two parsers on its way in, and a bundle sitting somewhere
// like `/Users/me/Ada's Apps` carries a character that ends a shell word.
// Kept apart from the electron code so it can be tested on its own.

/**
 * `text` as one POSIX shell word. Single quotes take everything literally,
 * so only a single quote itself needs work: leave the quoting, contribute an
 * escaped one, resume. `Ada's` becomes `'Ada'\''s'`.
 */
export function shellWord(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/**
 * `text` as the body of an AppleScript string literal. Backslashes first, or
 * the escape this adds for a quote would itself be escaped by the next pass.
 */
export function appleScriptLiteral(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
