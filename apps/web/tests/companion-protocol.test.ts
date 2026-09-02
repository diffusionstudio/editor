import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPANION_PROTOCOL_VERSION,
  COMPANION_SCHEMA_HASH,
  parseCompanionSnapshot,
} from "../src/lib/companion-protocol.ts";
import { createCompanionProjectFS, readCompanionProjectConfig } from "../src/projects/companion-fs.ts";

function validSnapshot(): Record<string, unknown> {
  return {
    protocol: COMPANION_PROTOCOL_VERSION,
    schemaHash: COMPANION_SCHEMA_HASH,
    appVersion: "0.204.1",
    buildHash: "same-apps-web-build",
    sessionId: "session-id",
    revision: 1,
    bundleHash: "a".repeat(64),
    project: { id: "project-id", name: "project-name", displayName: "Project" },
    bundle: { ok: true, code: "return undefined;" },
    capabilities: {
      readOnly: true,
      browserDapi: false,
      cloudAi: false,
      persistentEdits: false,
      htmlPaint: false,
      media: "unsupported-phase-a",
      webgpu: "browser-dependent",
      fonts: "browser-dependent",
    },
  };
}

test("Phase A snapshot accepts only its narrow wire allowlist", () => {
  const parsed = parseCompanionSnapshot(validSnapshot());
  assert.deepEqual(Object.keys(parsed).sort(), [
    "appVersion", "buildHash", "bundle", "bundleHash", "capabilities",
    "project", "protocol", "revision", "schemaHash", "sessionId",
  ]);

  for (const field of ["manifest", "config", "root", "path"]) {
    assert.throws(
      () => parseCompanionSnapshot({ ...validSnapshot(), [field]: `/private/${field}` }),
      /contains unsupported fields/,
    );
  }
  assert.throws(
    () => parseCompanionSnapshot({ ...validSnapshot(), project: { id: "id", name: "name", displayName: "Name", path: "/private" } }),
    /contains unsupported fields/,
  );
});

test("companion library and config initialize from explicit local empty values", async () => {
  const fs = createCompanionProjectFS("project-id");
  assert.deepEqual(await fs.readManifest(), { version: 1, folders: [], assets: [] });
  assert.deepEqual(await fs.list("assets"), []);
  assert.equal(await readCompanionProjectConfig(), null);
});
