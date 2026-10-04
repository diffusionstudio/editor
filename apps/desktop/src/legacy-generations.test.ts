/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Projects from before generation was removed are pointed at what their
// declarations produced. The keys below are in the shape the generation code
// wrote them: the request, defaults applied, inputs by asset id.

import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrateGenerations } from "./legacy-generations";

const FILE = "index.tsx";

const asset = (id: string, path: string, key?: string) => ({
  id,
  path,
  source: `assets/${path}`,
  type: "IMAGE",
  mimeType: "image/png",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...(key ? { generation: { key, id: "run" } } : {}),
});

const HERO_KEY = JSON.stringify({ type: "image", model: "flux", prompt: "A neon city", aspectRatio: "16:9", seed: 7, refIds: [] });
const MOTION_KEY = JSON.stringify({ type: "video", model: "kling", prompt: "push in", aspectRatio: "16:9", duration: 5, audio: false, seed: 3, startFrameId: "hero01" });
const UPSCALE_KEY = JSON.stringify({ type: "upscale", inputId: "photo1" });

const MANIFEST = {
  version: 1,
  folders: [],
  assets: [
    asset("hero01", "generated/A neon city.png", HERO_KEY),
    asset("motion", "generated/push in.mp4", MOTION_KEY),
    asset("photo1", "photos/me.png"),
    asset("upsc01", "generated/me (Upscaled).png", UPSCALE_KEY),
    asset("capt01", "generated/Captions 1.json", "transcript:v1:intro:123"),
    asset("capt02", "generated/Captions 2.json", "transcript:v1:outro:0"),
    // A failed generation's record: no bytes, so no answer.
    { id: "fail01", path: "generated/a fox", type: "IMAGE", createdAt: "2026-01-01", generation: { key: "x" }, state: "error" },
  ],
};

let dir: string;
const written: string[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "legacy-generations-test-"));
  written.length = 0;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function migrate(source: string, manifest: unknown = MANIFEST): Promise<string> {
  await writeFile(join(dir, FILE), source);
  await migrateGenerations({ dir, onWrite: (file) => written.push(file) }, manifest);
  return readFile(join(dir, FILE), "utf8");
}

describe("migrateGenerations", () => {
  it("points declarations at the assets they made, chains and consts included, and drops the import", async () => {
    const text = await migrate(`import { For } from "solid-js";
import { generate, transform } from "@diffusionstudio/jsx";

const hero = generate.image({ prompt: "A neon city", aspectRatio: "16:9", seed: 7 });
const motion = generate.video({ prompt: "push in", startFrame: hero, seed: 3 });

export default () => (
  <scene id="intro">
    <video id="a" src={motion} />
    <image id="b" src={transform.upscale("photos/me.png")} />
  </scene>
);
`);

    expect(text).toContain(`const hero = "generated/A neon city.png";`);
    expect(text).toContain(`const motion = "generated/push in.mp4";`);
    expect(text).toContain(`<image id="b" src="generated/me (Upscaled).png" />`);
    expect(text).not.toContain("@diffusionstudio/jsx");
    expect(text).toContain(`import { For } from "solid-js";`);
    expect(written).toEqual([FILE]);
  });

  it("keeps a declaration nothing matches beside an empty source, so the project still loads", async () => {
    const text = await migrate(`import { generate } from "@diffusionstudio/jsx";
export default () => <image id="c" src={generate.image({ prompt: "never made", seed: 1 })} />;
`);

    expect(text).toContain(`src={"" /* no generated asset matched; generation was removed: generate.image({ prompt: "never made", seed: 1 }) */}`);
    expect(text).not.toContain("import { generate }");
  });

  it("does not take a key whose recorded fields differ from what the call spells", async () => {
    const text = await migrate(`import { generate } from "@diffusionstudio/jsx";
export default () => <image id="c" src={generate.image({ prompt: "A neon city", seed: 8 })} />;
`);

    expect(text).not.toContain("A neon city.png");
  });

  it("gives a src-less caption the transcript of its scene and seed", async () => {
    const text = await migrate(`export default () => (
  <stage>
    <scene id="intro"><captions id="c1" preset="classic" seed={123} /></scene>
    <scene id="outro"><Captions id="c2" /></scene>
    <scene id="other"><captions id="c3" /></scene>
  </stage>
);
`);

    expect(text).toContain(`<captions id="c1" preset="classic" src="generated/Captions 1.json" />`);
    expect(text).toContain(`<Captions src="generated/Captions 2.json" id="c2" />`);
    // No transcript was ever made for this scene: left as it was.
    expect(text).toContain(`<captions id="c3" />`);
  });

  it("writes nothing to a migrated project, or without a readable library", async () => {
    const source = `import { generate } from "@diffusionstudio/jsx";
export default () => <image id="c" src={generate.image({ prompt: "A neon city", seed: 7 })} />;
`;
    expect(await migrate(source, null)).toBe(source);
    expect(written).toEqual([]);

    const migrated = await migrate(source);
    expect(migrated).toContain(`src="generated/A neon city.png"`);
    written.length = 0;

    await migrateGenerations({ dir, onWrite: (file) => written.push(file) }, MANIFEST);
    expect(written).toEqual([]);
  });
});
