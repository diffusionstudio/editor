import assert from "node:assert/strict";
import test from "node:test";

import { fontSourcesForMode } from "../src/lib/companion-fonts.ts";

test("companion choices contain only bundled/system local sources", () => {
  let remoteDiscovery = 0;
  const fonts = fontSourcesForMode(true, () => {
    remoteDiscovery++;
    return [{ family: "Remote", variants: [{ family: "Remote", source: "url(https://example.test/font.woff2)" }] }];
  });
  assert.equal(remoteDiscovery, 0);
  assert(fonts.some((font) => font.family === "Inter"));
  assert(fonts.some((font) => font.family === "system-ui"));
  assert.doesNotMatch(JSON.stringify(fonts), /https?:|url\(/);
});

test("ordinary desktop choices are returned unchanged", () => {
  const ordinary = [{ family: "Remote", variants: [{ family: "Remote", source: "url(https://example.test/font.woff2)" }] }];
  assert.equal(fontSourcesForMode(false, () => ordinary), ordinary);
});
