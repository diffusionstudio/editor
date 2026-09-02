import assert from "node:assert/strict";
import test from "node:test";

import { OneShotCapture } from "../src/browser-companion-capture.ts";

test("inactive ordinary desktop publications retain no bundle", () => {
  const capture = new OneShotCapture<{ code: string }>();
  assert.equal(capture.publish("/project", { code: "ordinary desktop compile" }), false);
  assert.deepEqual(capture.inspect(), { armed: false, retainedValues: 0 });
});

test("start, stop, and same-project restart each consume a fresh bounded capture", async () => {
  const capture = new OneShotCapture<{ code: string }>();

  capture.arm("/project", 1_000, "timed out");
  assert.equal(capture.publish("/project", { code: "first compile" }), true);
  assert.deepEqual(await capture.take("/project"), { code: "first compile" });
  assert.deepEqual(capture.inspect(), { armed: false, retainedValues: 0 });

  // A stopped companion leaves no reusable result. The identical project
  // must be explicitly armed and publish again for the next start.
  assert.equal(capture.publish("/project", { code: "compile while stopped" }), false);
  capture.arm("/project", 1_000, "timed out");
  const restarted = capture.take("/project");
  assert.equal(capture.publish("/other", { code: "wrong project" }), false);
  assert.equal(capture.publish("/project", { code: "fresh restart compile" }), true);
  assert.deepEqual(await restarted, { code: "fresh restart compile" });
  assert.deepEqual(capture.inspect(), { armed: false, retainedValues: 0 });
});

test("an abandoned capture expires and releases its retained value", async () => {
  const capture = new OneShotCapture<{ code: string }>();
  capture.arm("/project", 20, "capture expired");
  assert.equal(capture.publish("/project", { code: "unclaimed" }), true);
  assert.deepEqual(capture.inspect(), { armed: false, retainedValues: 1 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(capture.inspect(), { armed: false, retainedValues: 0 });
});
