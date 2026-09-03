import assert from "node:assert/strict";
import test from "node:test";

import {
  canLoadRemoteWebFonts,
  resolveWebFontSource,
  setRemoteWebFontsEnabled,
} from "../src/fonts/policy.ts";

test.afterEach(() => setRemoteWebFontsEnabled(true));

test("local-only font resolution exposes no remote URL and disables remote loading", () => {
  setRemoteWebFontsEnabled(false);
  assert.equal(canLoadRemoteWebFonts(), false);
  const source = resolveWebFontSource("Inter", "https://fonts.example.test/inter.woff2");
  assert.equal(source, "local('Inter')");
  assert.doesNotMatch(source, /https?:|url\(/);
});

test("ordinary runtime retains remote source resolution", () => {
  setRemoteWebFontsEnabled(true);
  assert.equal(canLoadRemoteWebFonts(), true);
  assert.equal(
    resolveWebFontSource("Inter", "https://fonts.gstatic.com/inter.woff2"),
    "url(https://fonts.gstatic.com/inter.woff2)",
  );
});
