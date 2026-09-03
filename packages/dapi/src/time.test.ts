/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { NonNegativeTime, Time } from "./time";

describe("Time", () => {
  it.each([
    [1.5, 1.5],
    ["1.5", 1.5],
    ["45f", 1.5],
    ["-30f", -1],
    ["1:30", 90],
    ["01:02:03", 3723],
    ["-1", -1],
    [" 2 ", 2],
  ])("parses %j to %d seconds", (input, seconds) => {
    expect(Time.parse(input)).toBe(seconds);
  });

  it.each(["", "abc", "1:2:3:4", "1:x"])(
    "rejects %j with a message that names the accepted forms",
    (input) => {
      const result = Time.safeParse(input);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]!.message).toMatch(/seconds \("1.5"\), frames \("45f"\), or "MM:SS"/);
    },
  );

  it("rejects other JSON types before trying to parse them", () => {
    expect(Time.safeParse(null).success).toBe(false);
    expect(Time.safeParse({ seconds: 1 }).success).toBe(false);
    expect(Time.safeParse(Number.NaN).success).toBe(false);
    expect(Time.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
  });
});

describe("NonNegativeTime", () => {
  it("accepts zero and positive times", () => {
    expect(NonNegativeTime.parse(0)).toBe(0);
    expect(NonNegativeTime.parse("0:10")).toBe(10);
  });

  it("rejects negative times after parsing them", () => {
    const result = NonNegativeTime.safeParse("-1f");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]!.message).toMatch(/non-negative/);
  });
});
