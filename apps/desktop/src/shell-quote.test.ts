/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { appleScriptLiteral, shellWord } from "./shell-quote";

/** Bundle locations a person could plausibly end up with, and then some. */
const PATHS = [
  "/Applications/Diffusion Studio.app/Contents/Resources/cli/bin/dapi",
  "/Users/me/Ada's Apps/Diffusion Studio.app/Contents/Resources/cli/bin/dapi",
  "/Users/me/back\\slash/dapi",
  '/Users/me/say "hi"/dapi',
  "/Users/me/'/dapi",
  "/Users/me/$(id)/dapi",
  "/Users/me/`id`/dapi",
  "/Users/me/a;rm -rf ~/dapi",
];

describe("shellWord", () => {
  it("wraps a plain path in quotes and leaves it alone", () => {
    expect(shellWord("/Applications/D.app/dapi")).toBe("'/Applications/D.app/dapi'");
  });

  it("closes, escapes and resumes around a single quote", () => {
    expect(shellWord("Ada's")).toBe(`'Ada'\\''s'`);
    expect(shellWord("'")).toBe(`''\\'''`);
  });

  it("gives substitutions and separators no way out of the word", () => {
    // Each stays one word, with nothing for the shell to expand or split on.
    expect(shellWord("$(id)")).toBe("'$(id)'");
    expect(shellWord("a;rm -rf ~")).toBe("'a;rm -rf ~'");
    expect(shellWord("`id`")).toBe("'`id`'");
  });
});

describe("appleScriptLiteral", () => {
  it("escapes what ends or continues a string literal", () => {
    expect(appleScriptLiteral('say "hi"')).toBe('say \\"hi\\"');
    expect(appleScriptLiteral("back\\slash")).toBe("back\\\\slash");
  });

  it("escapes the backslash before the quote it adds, not after", () => {
    // A naive quote-first pass would turn \" into \\" and end the literal.
    expect(appleScriptLiteral('\\"')).toBe('\\\\\\"');
  });

  it("leaves an ordinary line untouched", () => {
    const line = "mkdir -p /usr/local/bin && ln -sf '/a/b' '/usr/local/bin/dapi'";
    expect(appleScriptLiteral(line)).toBe(line);
  });
});

describe("the two together", () => {
  it("survives both parsers for every path", () => {
    for (const path of PATHS) {
      const line = `ln -sf ${shellWord(path)} '/usr/local/bin/dapi'`;
      const literal = appleScriptLiteral(line);
      // What AppleScript hands the shell is the line again, unchanged.
      expect(unescapeAppleScript(literal)).toBe(line);
      // And the shell word still holds the whole path.
      expect(line).toContain(shellWord(path));
    }
  });
});

/** What AppleScript does to a string literal's body, for checking the round trip. */
function unescapeAppleScript(body: string): string {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && i + 1 < body.length) {
      out += body[++i];
      continue;
    }
    out += body[i];
  }
  return out;
}
