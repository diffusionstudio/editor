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
import { mediaSegment } from "./media-segment";
import { mediaTranscribe } from "./media-transcribe";
import { generate, generatedPath } from "./generate";

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
    expect(args.separate).toBeUndefined();
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
    expect(issues(input.safeParse({ path: "/c.mp4", separate: true, perSheet: 4 }))).toHaveProperty("perSheet");
    expect(issues(input.safeParse({ path: "/c.mp4", perSheet: 13 }))).toHaveProperty("perSheet");
    expect(input.safeParse({ path: "/c.mp4", perSheet: 12 }).success).toBe(true);
  });
});

describe("capture", () => {
  it("takes non-negative times in every form", () => {
    expect(capture.input.parse({ id: "intro", times: [0, "45f", "1:10"] }).times).toEqual([0, 1.5, 70]);
    expect(capture.input.safeParse({ id: "intro", times: [-1] }).success).toBe(false);
    expect(capture.input.safeParse({ id: "intro", times: ["-2f"] }).success).toBe(false);
  });

  it("shares the sheet rule with media_grab", () => {
    expect(issues(capture.input.safeParse({ id: "intro", separate: true, perSheet: 2 }))).toHaveProperty("perSheet");
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
    expect(logs.input.safeParse({ contains: "" }).success).toBe(false);
    expect(logs.input.safeParse({ since: 1700000000000, contains: "export" }).success).toBe(true);
    expect(exportScene.input.safeParse({ id: "" }).success).toBe(false);
  });
});

describe("context", () => {
  it("reports the same shape with and without an open project", () => {
    expect(
      context.output.safeParse({ rootDir: "/p", projectDir: null, currentTime: null, fontFamilies: [], masks: [] }).success,
    ).toBe(true);
    expect(
      context.output.safeParse({
        rootDir: "/p",
        projectDir: "/p/a",
        currentTime: null,
        fontFamilies: ["Inter"],
        masks: [],
      }).success,
    ).toBe(true);
    expect(context.output.safeParse({ rootDir: "/p", projectDir: "/p/a" }).success).toBe(false);
  });

  it("reports background mask tracks, with a contact sheet as bytes in the result and a path in the output", () => {
    const span = { model: "tiny", frameRate: 30, start: 0, end: 2, frames: 60 };
    const running = { id: "t1", src: "masks/a/Tracking 1.mask", video: "a.mp4", state: "tracking", progress: 0.4, ...span };
    const found = { bbox: null, area: 0, score: 1, iou: 0.9, lost: [], weak: [] };
    const base = { rootDir: "/p", projectDir: "/p/a", currentTime: null, fontFamilies: [] };
    expect(context.output.safeParse({ ...base, masks: [running] }).success).toBe(true);
    expect(context.result!.safeParse({ ...base, masks: [{ ...running, state: "done", progress: 1, png: new Uint8Array(3), ...found }] }).success).toBe(true);
    expect(context.output.safeParse({ ...base, masks: [{ ...running, state: "done", progress: 1, image: "/tmp/s.png", ...found }] }).success).toBe(true);
    expect(context.output.safeParse({ ...base, masks: [{ ...running, state: "paused" }] }).success).toBe(false);
  });
});

describe("media_transcribe", () => {
  it("presents the transcript as a file: the result carries segments, the output a path", () => {
    const segments = [{ text: "Hi", words: [{ text: "Hi", start: 0, end: 0.2 }] }];
    expect(mediaTranscribe.result!.safeParse({ segments }).success).toBe(true);
    expect(mediaTranscribe.output.safeParse({ path: "/tmp/t.json", segments: 1, words: 1 }).success).toBe(true);
    expect(mediaTranscribe.output.safeParse({ segments }).success).toBe(false);
  });
});

describe("image tools", () => {
  it("present bytes as paths: the result carries png, the output a path", () => {
    expect(capture.result!.safeParse([{ timecode: "0f", png: new Uint8Array(3) }]).success).toBe(true);
    expect(capture.output.safeParse({ images: [{ timecode: "0f", path: "/tmp/0f.png" }] }).success).toBe(true);
    expect(capture.output.safeParse({ images: [{ timecode: "0f", png: new Uint8Array(3) }] }).success).toBe(false);
  });
});

describe("media_segment", () => {
  const input = mediaSegment.input;
  const at = { path: "/c.mp4", time: "1.5" };

  it("takes points, exclusions and a box, with the time in every form", () => {
    const args = input.parse({ ...at, points: [{ x: 0.5, y: 0.4 }], exclude: [{ x: 0.5, y: 0.9 }], box: [0.2, 0.1, 0.8, 0.95] });
    expect(args.time).toBe(1.5);
    expect(input.parse({ path: "/c.mp4", time: "45f", box: [0, 0, 1, 1] }).time).toBe(1.5);
  });

  it("needs the object prompted by points or a box", () => {
    expect(issues(input.safeParse(at))).toHaveProperty("points");
    expect(issues(input.safeParse({ ...at, exclude: [{ x: 0.1, y: 0.1 }] }))).toHaveProperty("points");
    expect(input.safeParse({ ...at, points: [{ x: 0, y: 1 }] }).success).toBe(true);
  });

  it("keeps prompts inside the frame and boxes the right way round", () => {
    expect(input.safeParse({ ...at, points: [{ x: 1.2, y: 0.5 }] }).success).toBe(false);
    expect(issues(input.safeParse({ ...at, box: [0.8, 0.1, 0.2, 0.9] }))).toHaveProperty("box");
    expect(issues(input.safeParse({ ...at, box: [-0.1, 0.1, 0.2, 0.9] }))).toHaveProperty("box");
  });

  it("rejects a span or an output on a preview", () => {
    const preview = { ...at, points: [{ x: 0.5, y: 0.5 }], preview: true };
    expect(input.safeParse(preview).success).toBe(true);
    expect(issues(input.safeParse({ ...preview, start: 1 }))).toHaveProperty("start");
    expect(issues(input.safeParse({ ...preview, output: "masks/a.mask" }))).toHaveProperty("output");
  });

  it("tracks a span that holds the prompted frame", () => {
    const track = { ...at, points: [{ x: 0.5, y: 0.5 }] };
    expect(input.safeParse({ ...track, start: 1, end: "0:03" }).success).toBe(true);
    expect(issues(input.safeParse({ ...track, start: 2 }))).toHaveProperty("time");
    expect(issues(input.safeParse({ ...track, end: 1.5 }))).toHaveProperty("time");
    expect(issues(input.safeParse({ ...track, start: 3, end: 2 }))).toHaveProperty("end");
  });

  it("answers a background track with its paths and span alone", () => {
    const span = { model: "tiny", frameRate: 30, start: 0, end: 2, frames: 60 };
    expect(mediaSegment.output.safeParse({ path: "/p/assets/masks/a.mask", src: "masks/a.mask", state: "tracking", ...span }).success).toBe(true);
    expect(mediaSegment.output.safeParse({ path: "/p/assets/masks/a.mask", state: "queued", ...span }).success).toBe(false);
  });

  it("names only the models the app offers", () => {
    expect(input.safeParse({ ...at, box: [0, 0, 1, 1], model: "base-plus" }).success).toBe(true);
    expect(input.safeParse({ ...at, box: [0, 0, 1, 1], model: "huge" }).success).toBe(false);
  });
});

describe("generate", () => {
  const input = generate.input;

  it("passes the model's fields through unchecked, for the API to validate", () => {
    const fields = { prompt: "a fox", images: [{ path: "./ref.png" }, { kind: "url", url: "https://x.test/a.png" }], duration: 99, anything: { at: "all" } };
    expect(input.parse({ model: "nano-banana-pro", ...fields })).toEqual({ model: "nano-banana-pro", ...fields });
  });

  it("knows the models", () => {
    expect(issues(input.safeParse({ model: "dall-e-1", prompt: "a fox" }))).toHaveProperty("model");
  });

  it("lets a job's fields beyond the documented ones through to the caller", () => {
    const job = { id: "j", model: "flux-2-klein", status: "succeeded", etaSeconds: 9, etaRemainingSeconds: null, credits: 2, error: null, createdAt: "2026-10-06T00:00:00Z", assets: [{ path: "/a.png", filename: "a.png", width: 1024 }] };
    expect(generate.output.parse(job)).toEqual(job);
  });
});

describe("generatedPath", () => {
  it("saves a single file at the output, keeping an extension that matches", () => {
    expect(generatedPath("b-roll/fox.png", "red-fox.png", 0, 1)).toBe("b-roll/fox.png");
    expect(generatedPath("/out/fox.JPEG", "red-fox.jpg", 0, 1)).toBe("/out/fox.JPEG");
  });

  it("corrects or adds the extension to what the model made", () => {
    expect(generatedPath("/out/fox.jpg", "red-fox.png", 0, 1)).toBe("/out/fox.png");
    expect(generatedPath("clips/run", "fox-run.mp4", 0, 1)).toBe("clips/run.mp4");
    expect(generatedPath("C:\\out\\v1.2\\fox", "a.webp", 0, 1)).toBe("C:\\out\\v1.2\\fox.webp");
  });

  it("numbers the files of a job that made several", () => {
    expect([0, 1, 2].map((i) => generatedPath("fox.png", "a.png", i, 3))).toEqual(["fox-1.png", "fox-2.png", "fox-3.png"]);
  });
});
