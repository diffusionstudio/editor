import assert from "node:assert/strict";
import test from "node:test";

test("companion identity is captured once and survives public-global tamper attempts", async () => {
  const api = Object.freeze({
    enabled: true as const,
    localOnly: true as const,
    expectedBuildHash: "build-hash",
    connect: async () => null,
    subscribe: () => () => {},
    semantic: () => {},
    applied: () => {},
    recordOutboundAttempt: () => {},
  });
  const fakeWindow: Record<string, unknown> = {};
  Object.defineProperty(fakeWindow, "browserCompanion", {
    value: api,
    writable: false,
    configurable: false,
  });
  Object.defineProperty(globalThis, "window", {
    value: fakeWindow,
    writable: true,
    configurable: true,
  });

  try {
    const authority = await import(`../src/lib/companion-authority.ts?test=${Date.now()}`);
    assert.equal(authority.browserCompanionAuthority, api);
    assert.equal(authority.isBrowserCompanionRenderer(), true);

    assert.equal(Reflect.deleteProperty(fakeWindow, "browserCompanion"), false);
    assert.equal(Reflect.set(fakeWindow, "browserCompanion", undefined), false);
    assert.equal(Reflect.set(fakeWindow, "browserCompanion", { enabled: false }), false);
    assert.equal(Reflect.set(api, "expectedBuildHash", "tampered"), false);

    assert.equal(fakeWindow.browserCompanion, api);
    assert.equal(authority.browserCompanionAuthority, api);
    assert.equal(authority.isBrowserCompanionRenderer(), true);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});
