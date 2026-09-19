/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";

import { errorText, parseModel } from "../src/host/opencode";

describe("parseModel", () => {
  it("splits a provider/model value at the first slash", () => {
    expect(parseModel("opencode/deepseek-v4-flash")).toEqual({ providerID: "opencode", modelID: "deepseek-v4-flash" });
    expect(parseModel("anthropic/claude-sonnet-4-5")).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4-5" });
  });

  it("keeps a model id that holds a slash with the first provider segment", () => {
    expect(parseModel("openrouter/a/b")).toEqual({ providerID: "openrouter", modelID: "a/b" });
  });

  it("is null when there is no provider/model pair to send", () => {
    expect(parseModel("deepseek-v4-flash")).toBeNull();
    expect(parseModel("/sonnet")).toBeNull();
    expect(parseModel("anthropic/")).toBeNull();
  });
});

describe("errorText", () => {
  it("reads opencode's error envelope", () => {
    expect(errorText({ name: "ProviderAuthError", data: { message: "not signed in" } })).toBe("not signed in");
  });

  it("passes a plain string and a bare message through", () => {
    expect(errorText("boom")).toBe("boom");
    expect(errorText({ message: "boom" })).toBe("boom");
  });

  it("is undefined for an error it cannot read", () => {
    expect(errorText(undefined)).toBeUndefined();
    expect(errorText({ name: "UnknownError" })).toBeUndefined();
  });
});
