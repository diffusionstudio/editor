/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { capture } from "./capture";
import { context } from "./context";
import { exportScene } from "./export";
import { logs } from "./logs";
import { mediaFilmstrip } from "./media-filmstrip";
import { mediaGrab } from "./media-grab";
import { mediaListen } from "./media-listen";

/** The messages of a failed parse, keyed by the path they point at. */
function issues(result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) {
  expect(result.success).toBe(false);
  return Object.fromEntries((result.error?.issues ?? []).map((issue) => [issue.path.join("."), issue.message]));
}

describe("media_grab", () => {
  const input = mediaGrab.input;

  it("parses times in every form and applies the sheet default", () => {
    const args = input.parse({ path: "/clip.mp4", times: ["45f", "1:10", -1, "-2f"] });
    expect(args.times).toEqual([1.5, 70, -1, -2 / 30]);
    expect(args.combine).toBe(true);
    expect(args.perSheet).toBeUndefined();
  });

  it("rejects times together with count", () => {
    expect(issues(input.safeParse({ path: "/c.mp4", times: [1], count: 3 }))).toHaveProperty("count");
  });

  it("rejects auto together with times", () => {
    expect(issues(input.safeParse({ path: "/c.mp4", times: [1], auto: true }))).toHaveProperty("times");
  });

  it("requires count or auto for a window", () => {
    expect(issues(input.safeParse({ path: "/c.mp4", start: 1 }))).toHaveProperty("start");
    expect(input.safeParse({ path: "/c.mp4", start: 1, count: 2 }).success).toBe(true);
    expect(input.safeParse({ path: "/c.mp4", end: "0:10", auto: true }).success).toBe(true);
  });

  it("requires start before end", () => {
    const found = issues(input.safeParse({ path: "/c.mp4", start: 5, end: "2", count: 2 }));
    expect(found.end).toMatch(/start \(5s\) must be less than end \(2s\)/);
  });

  it("rejects negative window bounds but not negative times", () => {
    expect(issues(input.safeParse({ path: "/c.mp4", start: -1, count: 2 }))).toHaveProperty("start");
    expect(input.safeParse({ path: "/c.mp4", times: [-1] }).success).toBe(true);
  });

  it("caps the frame count unless uncapped", () => {
    expect(issues(input.safeParse({ path: "/c.mp4", count: 101 })).count).toMatch(/100-frame cap/);
    expect(input.safeParse({ path: "/c.mp4", count: 101, uncapped: true }).success).toBe(true);
    expect(input.safeParse({ path: "/c.mp4", count: 100 }).success).toBe(true);
  });

  it("rejects perSheet for separate images", () => {
    expect(issues(input.safeParse({ path: "/c.mp4", combine: false, perSheet: 4 }))).toHaveProperty("perSheet");
    expect(issues(input.safeParse({ path: "/c.mp4", perSheet: 13 }))).toHaveProperty("perSheet");
    expect(input.safeParse({ path: "/c.mp4", perSheet: 12 }).success).toBe(true);
  });
});

describe("capture", () => {
  it("takes non-negative integer frames", () => {
    expect(capture.input.parse({ id: "intro", frames: [0, 45] }).frames).toEqual([0, 45]);
    expect(capture.input.safeParse({ id: "intro", frames: [1.5] }).success).toBe(false);
    expect(capture.input.safeParse({ id: "intro", frames: [-1] }).success).toBe(false);
  });

  it("shares the sheet rule with media_grab", () => {
    expect(issues(capture.input.safeParse({ id: "intro", combine: false, perSheet: 2 }))).toHaveProperty("perSheet");
  });
});

describe("media_filmstrip and media_listen", () => {
  it("apply the window rule", () => {
    expect(issues(mediaFilmstrip.input.safeParse({ path: "/c.mp4", start: 3, end: 3 }))).toHaveProperty("end");
    expect(issues(mediaListen.input.safeParse({ path: "/c.mp4", start: "0:05", end: 4 }))).toHaveProperty("end");
    expect(mediaFilmstrip.input.safeParse({ path: "/c.mp4", scale: 0 }).success).toBe(false);
  });
});

describe("logs and export", () => {
  it("validate the small things the CLI used to check by hand", () => {
    expect(logs.input.safeParse({ tail: 0 }).success).toBe(false);
    expect(logs.input.safeParse({ tail: 5, level: "warning" }).success).toBe(true);
    expect(logs.input.safeParse({ level: "verbose" }).success).toBe(false);
    expect(exportScene.input.safeParse({ id: "" }).success).toBe(false);
  });
});

describe("context", () => {
  it("accepts both the closed and the open report", () => {
    expect(context.output.safeParse({ rootDir: "/p", projectDir: null }).success).toBe(true);
    expect(
      context.output.safeParse({
        rootDir: "/p",
        projectDir: "/p/a",
        currentTime: null,
        fontFamilies: ["Inter"],
        generations: [{ element: "index.tsx:3", name: null, state: "done", asset: "gen/a.mp4" }],
      }).success,
    ).toBe(true);
    expect(context.output.safeParse({ rootDir: "/p", projectDir: "/p/a" }).success).toBe(false);
  });
});
