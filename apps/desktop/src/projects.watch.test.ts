/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What the watcher must and must not report. The app writes the files it
// watches, so the whole question is whether a change is its own — answered by
// content (see `noteContent`), which is what these pin down.

import { tmpdir } from "node:os";
import { mkdir, mkdtemp, open, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAIN_CHANNELS, MAIN_WIRE } from "./main-channels";
import { TEMP_PREFIX, tempPathFor, writeFileAtomic } from "./atomic";

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => tmpdir() },
  dialog: {},
  shell: {},
  ipcMain: { on: () => { } },
}));

const { noteContent, noteRenamed, readConfig, unwatchProject, watchProject, writeConfig, writeManifest } = await import("./projects");

let dir: string;
let changed: string[] = [];

/** A window that only remembers which project files it was told about. */
const window = {
  isDestroyed: () => false,
  webContents: {
    isLoading: () => false,
    send: (wire: string, envelope: { channel: string; data: { path: string } }) => {
      if (wire === MAIN_WIRE.EVENT && envelope.channel === MAIN_CHANNELS.PROJECTS_CHANGED) {
        changed.push(envelope.data.path);
      }
    },
  },
} as unknown as Parameters<typeof watchProject>[0];

/** Long enough for an event to have arrived, for the cases where none may. */
const settle = (ms = 400): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for `path` to be reported, and fails the test when it never is. */
async function waitFor(path: string, timeout = 4000): Promise<void> {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (changed.includes(path)) return;
    await settle(25);
  }
  expect(changed).toContain(path);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "watch-test-"));
  changed = [];
  watchProject(window, dir);
  await settle(100);
});

afterEach(async () => {
  unwatchProject(dir);
  await rm(dir, { recursive: true, force: true });
});

describe("watchProject", () => {
  it("reports a file someone else writes", async () => {
    await writeFile(join(dir, "index.tsx"), "export const stage = 1;\n", "utf8");
    await waitFor("index.tsx");
  });

  // Without this the claim above proves nothing: a rename that never reached
  // the watcher would look exactly like a claim that worked.
  it("reports a file someone else replaces by rename", async () => {
    await writeFileAtomic(join(dir, "index.tsx"), "export const stage = 1;\n");
    await waitFor("index.tsx");
  });

  it("says nothing about a write the app claimed", async () => {
    const file = join(dir, "index.tsx");
    const text = "export const stage = 1;\n";
    noteContent(file, text);
    await writeFileAtomic(file, text);

    await settle();
    expect(changed).toEqual([]);
  });

  it("reports an outside edit that lands right after one of the app's own", async () => {
    const file = join(dir, "index.tsx");
    noteContent(file, "ours\n");
    await writeFileAtomic(file, "ours\n");
    // No claim: this one is someone else's, however close behind it comes.
    await writeFile(file, "theirs\n", "utf8");

    await waitFor("index.tsx");
  });

  it("says nothing about a write that changes nothing", async () => {
    const file = join(dir, "notes.txt");
    await writeFile(file, "same\n", "utf8");
    await waitFor("notes.txt");

    changed = [];
    await writeFile(file, "same\n", "utf8");
    await settle();
    expect(changed).toEqual([]);
  });

  it("reports a file someone else deletes", async () => {
    const file = join(dir, "notes.txt");
    await writeFile(file, "here\n", "utf8");
    await waitFor("notes.txt");

    changed = [];
    await rm(file);
    await waitFor("notes.txt");
  });

  it("ignores the temp files an atomic write leaves in the folder", async () => {
    await writeFile(join(dir, `${TEMP_PREFIX}index.tsx.1-1`), "half a file", "utf8");
    await settle();
    expect(changed).toEqual([]);
  });

  it("says nothing about an asset streamed to a temp file and renamed into place", async () => {
    await mkdir(join(dir, "assets"), { recursive: true });
    await waitFor("assets");
    const file = join(dir, "assets", "clip.bin");

    changed = [];
    const temp = tempPathFor(file);
    const handle = await open(temp, "wx");
    // Positioned chunks, the way an encoder writes one.
    await handle.write(Buffer.from("chunk one"), 0, 9, 0);
    await settle();
    await handle.write(Buffer.from(" and two"), 0, 8, 9);
    await handle.close();
    await settle();
    // Nothing has appeared where the library looks, so there is nothing to say.
    expect(changed).toEqual([]);

    await noteRenamed(temp, file);
    await rename(temp, file);
    await settle();
    expect(changed).toEqual([]);
  });

  it("reports an asset someone else renames into place", async () => {
    await mkdir(join(dir, "assets"), { recursive: true });
    await waitFor("assets");

    changed = [];
    const temp = tempPathFor(join(dir, "assets", "clip.bin"));
    await writeFile(temp, "theirs", "utf8");
    await rename(temp, join(dir, "assets", "clip.bin"));

    await waitFor("assets/clip.bin");
  });

  // The claim for a file too big to hash is its size and mtime, which a rename
  // has to carry across untouched for `noteRenamed` to mean anything.
  it("says nothing about a file too big to hash, claimed before its rename", async () => {
    const file = join(dir, "assets", "big.bin");
    await mkdir(join(dir, "assets"), { recursive: true });
    await waitFor("assets");

    changed = [];
    const temp = tempPathFor(file);
    await writeFile(temp, Buffer.alloc(9 * 1024 * 1024, 7));
    await noteRenamed(temp, file);
    await rename(temp, file);

    await settle();
    expect(changed).toEqual([]);
  });

  it("says nothing about the manifest it writes itself", async () => {
    await writeManifest(dir, { assets: [{ source: "assets/clip.mp4" }] });
    await settle();
    expect(changed).toEqual([]);
  });

  // A slider in the export settings writes the config on every move, so the
  // next write is claimed before the event for the last one is answered.
  it("says nothing about config writes that overlap, and keeps the last", async () => {
    await writeFile(join(dir, "package.json"), `${JSON.stringify({ name: "p" }, null, 2)}\n`, "utf8");
    await waitFor("package.json");

    changed = [];
    const writes: Promise<void>[] = [];
    for (let bitrate = 1; bitrate <= 40; bitrate++) {
      writes.push(writeConfig(dir, { export: { intro: { video: { bitrate } } } }));
      await settle(8);
    }
    await Promise.all(writes);

    await settle();
    expect(changed).toEqual([]);
    expect(await readConfig(dir)).toEqual({ export: { intro: { video: { bitrate: 40 } } } });
  });

  it("reports an outside edit that lands between two of the app's own", async () => {
    const file = join(dir, "index.tsx");
    noteContent(file, "ours\n");
    noteContent(file, "ours again\n");
    await writeFileAtomic(file, "ours\n");
    await writeFile(file, "theirs\n", "utf8");
    await waitFor("index.tsx");

    changed = [];
    await writeFileAtomic(file, "ours again\n");
    await settle();
    expect(changed).toEqual([]);
  });
});
