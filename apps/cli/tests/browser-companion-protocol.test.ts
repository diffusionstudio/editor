import assert from "node:assert/strict";
import test from "node:test";

import { isBrowserCompanionCommand } from "../src/browser-companion-protocol.ts";

test("accepts the narrow companion lifecycle commands", () => {
  assert.equal(isBrowserCompanionCommand({ kind: "browser-companion", action: "status" }), true);
  assert.equal(isBrowserCompanionCommand({ kind: "browser-companion", action: "prepare", projectDir: "/trusted/project" }), true);
  assert.equal(isBrowserCompanionCommand({ kind: "browser-companion", action: "logs" }), true);
  assert.equal(isBrowserCompanionCommand({ kind: "browser-companion", action: "stop" }), true);
  assert.equal(isBrowserCompanionCommand({
    kind: "browser-companion",
    action: "start",
    projectDir: "/trusted/project",
    projectId: "project-123",
  }), true);
  assert.equal(isBrowserCompanionCommand({
    kind: "browser-companion",
    action: "start",
    projectDir: "/new/project",
  }), true);
});

test("rejects malformed, overbroad, and authority-bearing messages", () => {
  const rejected = [
    null,
    {},
    { kind: "browser-companion", action: "prepare" },
    { kind: "browser-companion", action: "prepare", projectDir: "/trusted/project", projectId: "unexpected" },
    { kind: "browser-companion", action: "start", projectDir: "" },
    { kind: "browser-companion", action: "start", projectDir: "/trusted/project", projectId: "" },
    { kind: "browser-companion", action: "start", projectDir: "/trusted/project\0evil", projectId: "project-123" },
    { kind: "browser-companion", action: "status", path: "/etc/passwd" },
    { kind: "browser-companion", action: "write", projectDir: "/trusted/project", projectId: "project-123" },
    { kind: "browser-companion", action: "dapi", procedure: "export" },
  ];
  for (const value of rejected) assert.equal(isBrowserCompanionCommand(value), false, JSON.stringify(value));
});
