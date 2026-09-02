import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";

import {
  containedWebPath,
  exactCompanionOrigin,
  isCompanionAuthentication,
  isCompanionSemantic,
  isLoopbackCompanionUrl,
  redactCompanionLog,
} from "../src/browser-companion-security.ts";

test("origin matching is exact, including host spelling and port", () => {
  const expected = "http://127.0.0.1:43127";
  assert.equal(exactCompanionOrigin(expected, expected), true);
  assert.equal(exactCompanionOrigin(undefined, expected), false);
  assert.equal(exactCompanionOrigin("http://localhost:43127", expected), false);
  assert.equal(exactCompanionOrigin("http://127.0.0.1:43128", expected), false);
  assert.equal(exactCompanionOrigin(`${expected}.example.test`, expected), false);
  assert.equal(exactCompanionOrigin("null", expected), false);
});

test("zero-egress host guard allows loopback only", () => {
  assert.equal(isLoopbackCompanionUrl("http://127.0.0.1:5173/index.js"), true);
  assert.equal(isLoopbackCompanionUrl("ws://localhost:5173/socket"), true);
  assert.equal(isLoopbackCompanionUrl("http://[::1]:5173/"), true);
  assert.equal(isLoopbackCompanionUrl("https://api.diffusion.studio/"), false);
  assert.equal(isLoopbackCompanionUrl("https://localhost.example.test/"), false);
  assert.equal(isLoopbackCompanionUrl("not a URL"), false);
});

test("static paths cannot escape into traversal or prefix siblings", () => {
  const root = resolve("/srv/diffusion/web");
  assert.equal(containedWebPath(root, resolve(root, "index.html")), true);
  assert.equal(containedWebPath(root, root), true);
  assert.equal(containedWebPath(root, resolve(root, "../web-evil/index.html")), false);
  assert.equal(containedWebPath(root, resolve(root, "../../etc/passwd")), false);
});

test("semantic log allowlist rejects arbitrary renderer authority", () => {
  assert.equal(isCompanionSemantic("playback.play"), true);
  assert.equal(isCompanionSemantic("playback.pause"), true);
  assert.equal(isCompanionSemantic("playback.scrub"), true);
  assert.equal(isCompanionSemantic("project.write"), false);
  assert.equal(isCompanionSemantic("dapi.call"), false);
  assert.equal(isCompanionSemantic({ event: "playback.play" }), false);
});

test("logs redact the project root, capability, bearer values, and absolute paths", () => {
  const root = "/Users/tester/Secret Project";
  const capability = "one-time-capability-secret";
  const redacted = redactCompanionLog(
    `${root}/index.tsx ${capability} Bearer abc.def.ghi /tmp/private.mov C:\\Users\\tester\\private.mov`,
    [root, capability],
  );
  assert.doesNotMatch(redacted, /Secret Project|one-time-capability-secret|abc\.def\.ghi|private\.mov/);
  assert.match(redacted, /<redacted>/);
});

test("renderer authentication fails closed on every linkage mismatch and reuse", () => {
  const expected = {
    capability: "capability",
    buildHash: "web-build",
    protocol: 1,
    schemaHash: "schema-v1",
    appVersion: "0.204.0",
    capabilityConsumed: false,
    rendererConnected: false,
  };
  const message = {
    type: "authenticate",
    capability: "capability",
    buildHash: "web-build",
    client: { protocol: 1, schemaHash: "schema-v1", appVersion: "0.204.0" },
  };
  assert.equal(isCompanionAuthentication(message, expected), true);
  assert.equal(isCompanionAuthentication({ ...message, capability: "wrong" }, expected), false);
  assert.equal(isCompanionAuthentication({ ...message, buildHash: "wrong" }, expected), false);
  assert.equal(isCompanionAuthentication({ ...message, client: { ...message.client, protocol: 2 } }, expected), false);
  assert.equal(isCompanionAuthentication({ ...message, client: { ...message.client, schemaHash: "wrong" } }, expected), false);
  assert.equal(isCompanionAuthentication({ ...message, client: { ...message.client, appVersion: "wrong" } }, expected), false);
  assert.equal(isCompanionAuthentication(message, { ...expected, capabilityConsumed: true }), false);
  assert.equal(isCompanionAuthentication(message, { ...expected, rendererConnected: true }), false);
});
