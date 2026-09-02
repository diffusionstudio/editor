import assert from "node:assert/strict";
import test from "node:test";

import {
  companionUiCapabilities,
  documentMutationsEnabled,
  runDocumentMutation,
} from "../src/lib/companion-capabilities.ts";

test("browser companion exposes only inspection and playback in Phase A", () => {
  const capabilities = companionUiCapabilities(true);
  assert.deepEqual(capabilities, {
    inspect: true,
    playback: true,
    connectProjectFolder: false,
    ai: false,
    assetWrite: false,
    projectWrite: false,
    account: false,
    export: false,
    externalNavigation: false,
    desktopPromotion: false,
  });
});

test("ordinary desktop and web capability surfaces remain enabled", () => {
  const capabilities = companionUiCapabilities(false);
  assert.deepEqual(capabilities, {
    inspect: true,
    playback: true,
    connectProjectFolder: false,
    ai: true,
    assetWrite: true,
    projectWrite: true,
    account: true,
    export: true,
    externalNavigation: true,
    desktopPromotion: true,
  });
});

test("companion document mutations are denied before every side-effect body", () => {
  const attempts = ["text", "numeric", "font", "canvas-transform", "timeline-layer"] as const;
  const entered: string[] = [];

  assert.equal(documentMutationsEnabled(true), false);
  for (const attempt of attempts) {
    const result = runDocumentMutation(() => {
      entered.push(attempt);
      return "mutated";
    }, "readonly", true);
    assert.equal(result, "readonly");
  }
  assert.deepEqual(entered, []);
});

test("ordinary Electron document mutations execute unchanged", () => {
  let entered = 0;
  assert.equal(documentMutationsEnabled(false), true);
  const result = runDocumentMutation(() => {
    entered++;
    return "desktop-result";
  }, "readonly", false);
  assert.equal(result, "desktop-result");
  assert.equal(entered, 1);
});
