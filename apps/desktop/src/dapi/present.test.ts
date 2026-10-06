/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { present, toCallToolResult } from "./present";

const dir = mkdtempSync(join(tmpdir(), "dapi-present-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const png = (byte: number, size = 8) => new Uint8Array(size).fill(byte);

describe("present", () => {
  it("writes capture frames by timecode into the requested directory and returns their paths", async () => {
    const out = join(dir, "frames");
    const presented = await present("capture", { id: "intro", output: out }, [
      { timecode: "0f", png: png(1) },
      { timecode: "1s", png: png(2) },
    ]);
    expect(presented.output).toEqual({ images: [{ timecode: "0f", path: join(out, "0f.png") }, { timecode: "1s", path: join(out, "1s.png") }] });
    expect(readFileSync(join(out, "1s.png"))).toEqual(Buffer.from(png(2)));
  });

  it("picks a fresh temp directory when none is given", async () => {
    const presented = await present("media_grab", { path: "/c.mp4" }, [{ timecode: "0f", png: png(3) }]);
    const { path } = (presented.output as { images: Array<{ path: string }> }).images[0]!;
    expect(path).toMatch(/dapi-grab-.*[\\/]0f\.png$/);
    rmSync(join(path, ".."), { recursive: true, force: true });
  });

  it("keeps a preview's other fields next to the path", async () => {
    const file = join(dir, "wave.png");
    const presented = await present("media_waveform", { path: "/c.mp4", output: file }, { png: png(4), silences: [{ start: 0, end: 1 }] });
    expect(presented.output).toEqual({ path: file, silences: [{ start: 0, end: 1 }] });
  });

  it("writes a preview or transcript into an output that names an existing directory", async () => {
    const out = join(dir, "into");
    mkdirSync(out, { recursive: true });
    const preview = await present("media_waveform", { path: "/c.mp4", output: out }, { png: png(7), silences: [] });
    const previewPath = (preview.output as { path: string }).path;
    expect(dirname(previewPath)).toBe(out);
    expect(basename(previewPath)).toMatch(/^dapi-waveform-.*\.png$/);
    expect(readFileSync(previewPath)).toEqual(Buffer.from(png(7)));

    const transcript = await present("media_transcribe", { path: "/c.mp4", output: out }, { segments: [] });
    const transcriptPath = (transcript.output as { path: string }).path;
    expect(transcriptPath).toMatch(/dapi-transcript-.*\.json$/);
    expect(JSON.parse(readFileSync(transcriptPath, "utf8"))).toEqual({ segments: [] });
  });

  it("names screenshots by time and never overwrites one", async () => {
    const first = await present("screenshot", { output: dir }, { png: png(5), width: 10, height: 10 });
    const second = await present("screenshot", { output: dir }, { png: png(6), width: 10, height: 10 });
    const a = (first.output as { path: string }).path;
    const b = (second.output as { path: string }).path;
    expect(a).toMatch(/diffusion-studio_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.png$/);
    expect(b).not.toBe(a);
  });

  it("writes a transcript to a file, unchanged, and returns its path and size", async () => {
    const file = join(dir, "talk.json");
    const segments = [{ text: "Hi there", words: [{ text: "Hi", start: 0, end: 0.2 }, { text: "there", start: 0.3, end: 0.6 }] }];
    const presented = await present("media_transcribe", { path: "/c.mp4", output: file }, { segments });
    expect(presented).toEqual({ output: { path: file, segments: 1, words: 2 }, images: [] });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ segments });
  });

  it("writes a segment's mask where output says and its picture to the temp dir", async () => {
    const found = {
      model: "tiny" as const, frameRate: 30, start: 0, end: 1, frames: 30, bbox: null, area: 0, score: 1, iou: 0.9, lost: [], weak: [],
    };
    const file = join(dir, "masks", "skater.mask");
    const presented = await present("media_segment", { path: "/c.mp4", time: 0, output: file }, { png: png(8), mask: png(9, 4), ...found });
    const output = presented.output as { image: string; path: string };
    expect(output).toEqual({ image: output.image, path: file, ...found });
    expect(output.image).toMatch(/dapi-segment-.*\.png$/);
    expect(readFileSync(file)).toEqual(Buffer.from(png(9, 4)));
    expect(presented.images).toEqual([{ path: output.image, png: png(8) }]);
  });

  it("keeps the path of a mask the app put into the library, and writes none for a preview", async () => {
    const found = {
      model: "tiny" as const, frameRate: 30, start: 1, end: 1.033, frames: 1, bbox: null, area: 0, score: 1, iou: 0.9, lost: [], weak: [],
    };
    const stored = await present("media_segment", { path: "/c.mp4", time: 1 }, { png: png(8), path: "/p/assets/masks/a.mask", src: "masks/a.mask", ...found });
    expect(stored.output).toMatchObject({ path: "/p/assets/masks/a.mask", src: "masks/a.mask" });
    const preview = await present("media_segment", { path: "/c.mp4", time: 1, preview: true }, { png: png(8), ...found });
    expect(preview.output).not.toHaveProperty("path");
  });

  it("has no picture for a track still running in the background", async () => {
    const span = { model: "tiny" as const, frameRate: 30, start: 0, end: 2, frames: 60 };
    const running = await present("media_segment", { path: "/c.mp4", time: 1 }, { path: "/p/assets/masks/a.mask", src: "masks/a.mask", state: "tracking" as const, ...span });
    expect(running).toEqual({ output: { path: "/p/assets/masks/a.mask", src: "masks/a.mask", state: "tracking", ...span }, images: [] });
  });

  it("writes a done track's contact sheet once, inline only the first time context reports it", async () => {
    const row = {
      id: "track-1", src: "masks/a.mask", video: "a.mp4", state: "done" as const, progress: 1,
      model: "tiny" as const, frameRate: 30, start: 0, end: 2, frames: 60, bbox: null, area: 0, score: 1, iou: 0.9, lost: [], weak: [],
    };
    const base = { rootDir: "/p", projectDir: "/p/a", currentTime: null, fontFamilies: [] };
    const first = await present("context", {}, { ...base, masks: [{ ...row, png: png(8) }] });
    const image = (first.output as { masks: { image: string }[] }).masks[0]!.image;
    expect(image).toMatch(/dapi-segment-.*\.png$/);
    expect(first.images).toEqual([{ path: image, png: png(8) }]);
    expect(first.output).toEqual({ ...base, masks: [{ ...row, image }] });

    const again = await present("context", {}, { ...base, masks: [{ ...row, png: png(8) }] });
    expect(again).toEqual({ output: { ...base, masks: [{ ...row, image }] }, images: [] });
  });

  it("passes other results through untouched", async () => {
    expect(await present("check", { id: "x" }, { stats: {}, issues: [] })).toEqual({ output: { stats: {}, issues: [] }, images: [] });
  });
});

describe("toCallToolResult", () => {
  it("inlines a few small images and always carries the output as text and structure", () => {
    const result = toCallToolResult({ output: { images: [] }, images: [{ path: "/a.png", png: png(1) }] });
    expect(result.structuredContent).toEqual({ images: [] });
    expect(result.content[0]).toEqual({ type: "text", text: '{"images":[]}' });
    expect(result.content[1]).toMatchObject({ type: "image", mimeType: "image/png" });
  });

  it("sends paths only when there are many images or a large one", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ path: `/${i}.png`, png: png(i) }));
    expect(toCallToolResult({ output: {}, images: many }).content).toHaveLength(1);
    const large = [{ path: "/big.png", png: png(0, (1 << 20) + 1) }];
    expect(toCallToolResult({ output: {}, images: large }).content).toHaveLength(1);
  });
});

describe("present a generation job", () => {
  const job = (id: string, status: string, assets: Array<Record<string, unknown>>) => ({
    job: { id, status, credits: 4, etaSeconds: 10, etaRemainingSeconds: null, error: null, assets },
    saveTo: null as string | null,
  });
  const file = (filename: string) => ({ url: `https://files.test/${filename}`, filename, mimeType: "image/png", size: 8 });

  it("passes a job still running through as the API has it", async () => {
    const running = job("j-running", "running", []);
    expect((await present("job", { id: "j-running" }, running)).output).toEqual(running.job);
  });

  it("downloads a succeeded job's files once, to the output numbered and with the made extension", async () => {
    const fetch = vi.fn(async (url: string) => new Response(new Uint8Array([url.length])));
    vi.stubGlobal("fetch", fetch);
    try {
      const out = join(dir, "generated", "fox.jpg");
      const done = { ...job("j-done", "succeeded", [file("red-fox.png"), file("red-fox-2.png")]), saveTo: out };
      const first = await present("job", { id: "j-done" }, done);
      const again = await present("job", { id: "j-done" }, done);
      const assets = (first.output as { assets: Array<Record<string, unknown>> }).assets;
      expect(assets.map((asset) => asset.path)).toEqual([join(dir, "generated", "fox-1.png"), join(dir, "generated", "fox-2.png")]);
      expect(assets[0]).not.toHaveProperty("url");
      expect(assets[0]).toMatchObject({ filename: "red-fox.png", mimeType: "image/png" });
      expect(again.output).toEqual(first.output);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("writes a single file at the output, over a file already there", async () => {
    vi.stubGlobal("fetch", async () => new Response("new"));
    try {
      const out = join(dir, "single.png");
      writeFileSync(out, "old");
      const presented = await present("job", { id: "j-one" }, { ...job("j-one", "succeeded", [file("x.png")]), saveTo: out });
      expect((presented.output as { assets: Array<{ path: string }> }).assets[0]!.path).toBe(out);
      expect(readFileSync(out, "utf8")).toBe("new");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("saves into a directory of the job's own under the temp dir when no directory is given", async () => {
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array([1])));
    try {
      const presented = await present("generate", { model: "flux-2-klein" }, job("j-temp", "succeeded", [file("a.png")]));
      const path = (presented.output as { assets: Array<{ path: string }> }).assets[0]!.path;
      expect(path).toMatch(/dapi-generate-j-temp[\\/]a\.png$/);
      rmSync(dirname(path), { recursive: true, force: true });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("leaves files the renderer saved into the library as they are", async () => {
    const saved = job("j-lib", "succeeded", [{ filename: "a.png", path: "/p/assets/a.png", src: "a.png" }]);
    expect((await present("job", { id: "j-lib" }, saved)).output).toEqual(saved.job);
  });
});
