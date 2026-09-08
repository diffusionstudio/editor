/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { present, toCallToolResult } from "./present";

const dir = mkdtempSync(join(tmpdir(), "dapi-present-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const png = (byte: number, size = 8) => new Uint8Array(size).fill(byte);

describe("present", () => {
  it("writes capture frames by timecode into the requested directory and returns their paths", async () => {
    const out = join(dir, "frames");
    const presented = await present("capture", { id: "intro", combine: true, output: out }, [
      { timecode: "0f", png: png(1) },
      { timecode: "1s", png: png(2) },
    ]);
    expect(presented.output).toEqual({ images: [{ timecode: "0f", path: join(out, "0f.png") }, { timecode: "1s", path: join(out, "1s.png") }] });
    expect(readFileSync(join(out, "1s.png"))).toEqual(Buffer.from(png(2)));
  });

  it("picks a fresh temp directory when none is given", async () => {
    const presented = await present("media_grab", { path: "/c.mp4", combine: true }, [{ timecode: "0f", png: png(3) }]);
    const { path } = (presented.output as { images: Array<{ path: string }> }).images[0]!;
    expect(path).toMatch(/dapi-grab-.*[\\/]0f\.png$/);
    rmSync(join(path, ".."), { recursive: true, force: true });
  });

  it("keeps a preview's other fields next to the path", async () => {
    const file = join(dir, "wave.png");
    const presented = await present("media_waveform", { path: "/c.mp4", output: file }, { png: png(4), silences: [{ start: 0, end: 1 }] });
    expect(presented.output).toEqual({ path: file, silences: [{ start: 0, end: 1 }] });
  });

  it("names screenshots by time and never overwrites one", async () => {
    const first = await present("screenshot", { output: dir }, { png: png(5), width: 10, height: 10 });
    const second = await present("screenshot", { output: dir }, { png: png(6), width: 10, height: 10 });
    const a = (first.output as { path: string }).path;
    const b = (second.output as { path: string }).path;
    expect(a).toMatch(/diffusion-studio_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.png$/);
    expect(b).not.toBe(a);
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
