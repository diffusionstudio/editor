/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { isDapiError } from "./errors";
import { parseToolArgs } from "./validate";

describe("parseToolArgs", () => {
  it("returns parsed arguments with defaults applied", () => {
    expect(parseToolArgs("capture", { id: "intro" })).toEqual({ id: "intro", combine: true });
  });

  it("throws an invalid-input DapiError that names every bad field on one line", () => {
    try {
      parseToolArgs("media_grab", { path: "/c.mp4", times: ["abc"], count: 0 });
    } catch (e) {
      expect(isDapiError(e) && e.code).toBe("invalid-input");
      const message = (e as Error).message;
      expect(message).toMatch(/^Invalid arguments for media_grab: /);
      expect(message).toMatch(/times\.0: expected a time/);
      expect(message).toMatch(/count: /);
      expect(message).not.toContain("\n");
      return;
    }
    throw new Error("expected a throw");
  });
});
