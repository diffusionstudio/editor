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
import { mediaTranscribe } from "./media-transcribe";
import { generate, generatedPath, job } from "./generate";
import { MODEL_IDS } from "@diffusionstudio/api-contract";
import { LOCAL_MODEL_IDS, isLocalJobId, isLocalModel, samRequest } from "../local";

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
      context.output.safeParse({ rootDir: "/p", projectDir: null, currentTime: null, fontFamilies: [] }).success,
    ).toBe(true);
    expect(
      context.output.safeParse({
        rootDir: "/p",
        projectDir: "/p/a",
        currentTime: null,
        fontFamilies: ["Inter"],
      }).success,
    ).toBe(true);
    expect(context.output.safeParse({ rootDir: "/p", projectDir: "/p/a" }).success).toBe(false);
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

describe("sam-2.1", () => {
  const at = { model: "sam-2.1", video: { path: "/c.mp4" }, time: "1.5" };

  it("takes points, exclusions and a box, with the time in every form, and is tiny unless sized", () => {
    const args = samRequest.parse({ ...at, points: [{ x: 0.5, y: 0.4 }], exclude: [{ x: 0.5, y: 0.9 }], box: [0.2, 0.1, 0.8, 0.95] });
    expect(args.time).toBe(1.5);
    expect(args.size).toBe("tiny");
    expect(samRequest.parse({ ...at, time: "45f", box: [0, 0, 1, 1] }).time).toBe(1.5);
  });

  it("needs the object prompted by points or a box", () => {
    expect(issues(samRequest.safeParse(at))).toHaveProperty("points");
    expect(issues(samRequest.safeParse({ ...at, exclude: [{ x: 0.1, y: 0.1 }] }))).toHaveProperty("points");
    expect(samRequest.safeParse({ ...at, points: [{ x: 0, y: 1 }] }).success).toBe(true);
  });

  it("keeps prompts inside the frame and boxes the right way round", () => {
    expect(samRequest.safeParse({ ...at, points: [{ x: 1.2, y: 0.5 }] }).success).toBe(false);
    expect(issues(samRequest.safeParse({ ...at, box: [0.8, 0.1, 0.2, 0.9] }))).toHaveProperty("box");
    expect(issues(samRequest.safeParse({ ...at, box: [-0.1, 0.1, 0.2, 0.9] }))).toHaveProperty("box");
  });

  it("rejects a span or an output on a preview", () => {
    const preview = { ...at, points: [{ x: 0.5, y: 0.5 }], preview: true };
    expect(samRequest.safeParse(preview).success).toBe(true);
    expect(issues(samRequest.safeParse({ ...preview, start: 1 }))).toHaveProperty("start");
    expect(issues(samRequest.safeParse({ ...preview, output: "masks/a.mask" }))).toHaveProperty("output");
  });

  it("tracks a span that holds the prompted frame", () => {
    const track = { ...at, points: [{ x: 0.5, y: 0.5 }] };
    expect(samRequest.safeParse({ ...track, start: 1, end: "0:03", output: "masks/a.mask", maxCredits: 5 }).success).toBe(true);
    expect(issues(samRequest.safeParse({ ...track, start: 2 }))).toHaveProperty("time");
    expect(issues(samRequest.safeParse({ ...track, end: 1.5 }))).toHaveProperty("time");
    expect(issues(samRequest.safeParse({ ...track, start: 3, end: 2 }))).toHaveProperty("end");
  });

  it("names only the sizes the app offers, and no field it does not take", () => {
    const boxed = { ...at, box: [0, 0, 1, 1] };
    expect(samRequest.safeParse({ ...boxed, size: "base-plus" }).success).toBe(true);
    expect(samRequest.safeParse({ ...boxed, size: "huge" }).success).toBe(false);
    expect(samRequest.safeParse({ ...boxed, boxes: [] }).success).toBe(false);
    expect(samRequest.safeParse({ ...boxed, video: "/c.mp4" }).success).toBe(false);
  });
});

describe("local models", () => {
  it("share no id with the API's", () => {
    expect(LOCAL_MODEL_IDS.filter((id) => (MODEL_IDS as string[]).includes(id))).toEqual([]);
    expect(isLocalModel("sam-2.1")).toBe(true);
    expect(isLocalModel("flux-2-klein")).toBe(false);
    expect(isLocalModel("toString")).toBe(false);
  });

  it("run as jobs whose ids say so", () => {
    expect(generate.input.safeParse({ model: "sam-2.1", video: { path: "/c.mp4" } }).success).toBe(true);
    expect(isLocalJobId("local-3f2a")).toBe(true);
    expect(isLocalJobId("b22bbf6f-4c94-4a5b-a4c7-98c696706906")).toBe(false);
    const running = { id: "local-1", status: "running", phase: "tracking", progress: 0.4, assets: [], details: { frames: 60 } };
    expect(job.output.parse(running)).toEqual(running);
    expect(generate.result!.safeParse({ job: { id: "local-1", status: "succeeded", assets: [{ bytes: new Uint8Array(3), filename: "a.mask" }] }, saveTo: null, image: new Uint8Array(3) }).success).toBe(true);
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
