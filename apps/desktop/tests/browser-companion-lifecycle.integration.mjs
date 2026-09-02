import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const projectDir = process.env.DIFFUSION_COMPANION_TEST_PROJECT;
const cli = resolve(import.meta.dirname, "../../cli/dist/index.js");

function command(...args) {
  const output = execFileSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    timeout: 60_000,
  }).trim();
  return JSON.parse(output);
}

test("live stop then same-project start gets a fresh session while DAPI survives", {
  skip: projectDir ? false : "Set DIFFUSION_COMPANION_TEST_PROJECT and run a built local Electron host",
}, () => {
  const expected = resolve(projectDir);
  command("browser", "--stop");
  try {
    const first = command("browser", expected);
    assert.equal(first.active, true);
    assert.equal(first.hostWindowVisible, false);
    assert.equal(first.hostLocalOnly, true);
    assert.equal(first.lifecycle, "awaiting-renderer");
    assert.deepEqual(first.canonicalCompiled, first.hostApplied);
    assert.equal(first.canonicalCompiled.sessionId, first.sessionId);
    assert.equal(first.canonicalCompiled.revision, 1);

    const firstStopped = command("browser", "--stop");
    assert.deepEqual(firstStopped, { active: false, hostLocalOnly: false });
    assert.equal(command("context").projectDir, expected);

    const second = command("browser", expected);
    assert.equal(second.active, true);
    assert.equal(second.hostWindowVisible, false);
    assert.equal(second.hostLocalOnly, true);
    assert.equal(second.lifecycle, "awaiting-renderer");
    assert.deepEqual(second.canonicalCompiled, second.hostApplied);
    assert.equal(second.canonicalCompiled.sessionId, second.sessionId);
    assert.equal(second.canonicalCompiled.revision, 1);
    assert.equal(second.project.id, first.project.id);
    assert.notEqual(second.sessionId, first.sessionId);
    assert.notEqual(second.origin, first.origin);

    const secondStopped = command("browser", "--stop");
    assert.deepEqual(secondStopped, { active: false, hostLocalOnly: false });
    assert.equal(command("context").projectDir, expected);
  } finally {
    command("browser", "--stop");
  }
});
