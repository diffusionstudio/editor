/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { app, dialog, shell, type BrowserWindow } from "electron";
import { execFile } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { cp, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { nanoid } from "nanoid";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type { TransformOptions } from "@babel/core";
import type { BuildOptions, Plugin } from "esbuild";

import { isHeadless } from "./cli-server";
import { mainBridge } from "./main-manager";
import { MAIN_CHANNELS } from "./main-channels";
import { applyEdits, stampProject } from "./edit";
import { canonicalizeTagsPlugin, sourcePlugin } from "./source";
import type { CompileResult, FsEntry, FsStat, ProjectInfo, SourceEdit, WriteResult } from "./main-channels";
import type { SourceContext } from "./edit";

/** Entry points looked up in a project folder, in order of preference. */
export const ENTRY_FILES = ["index.tsx", "index.ts", "index.jsx", "index.js"];

/** The module compiled project code imports its JSX runtime from. */
const RUNTIME_MODULE = "@diffusionstudio/jsx";

/**
 * Imports left for the renderer to resolve against its own module instances
 * (one solid-js reactive graph, one JSX host).
 */
const EXTERNAL = ["solid-js", "solid-js/*", RUNTIME_MODULE];

const BUILD_OPTIONS: BuildOptions = {
  bundle: true,
  write: false,
  format: "cjs",
  platform: "browser",
  target: "chrome130",
  external: EXTERNAL,
  logLevel: "silent",
};

// esbuild and babel are kept external to the main bundle (esbuild ships a
// native binary). In development they resolve from the workspace; a packaged
// app has no node_modules of its own, so they load from the CLI's staged
// runtime at Contents/Resources/cli/node_modules (see scripts/stage-cli.mjs).
let stagedRequire: NodeJS.Require | undefined;

function load<T>(name: string): T {
  if (!app.isPackaged) return require(name) as T;
  stagedRequire ??= createRequire(join(process.resourcesPath, "cli", "package.json"));
  return stagedRequire(name) as T;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

type PackageJson = {
  name?: string;
  projectId?: string;
  displayName?: string;
  main?: string;
} & Record<string, unknown>;

async function readPackage(dir: string): Promise<PackageJson | null> {
  try {
    return JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

async function writePackage(dir: string, pkg: PackageJson): Promise<void> {
  await writeFile(join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Identity

// A project is named twice: `displayName` is what the user calls it and the
// folder is what the disk calls it, and renaming moves both. Neither can be
// the project's identity, so the record carries an id that nothing renames —
// it is what the app's URLs point at, and what the editor keys the open world
// by. Top level rather than inside `diffusion`, which `writeConfig` replaces
// whole. A `nanoid()`: 21 url-safe characters, so it takes no encoding to be
// a path segment.

/** The id a record carries, or "" for a folder that predates them. */
const recordedId = (pkg: PackageJson | null): string =>
  typeof pkg?.projectId === "string" ? pkg.projectId.trim() : "";

/**
 * The project's id, minting and recording one when the folder has none: a
 * folder made before ids existed, or by hand, gets one the first time the app
 * opens it (see `resolveProject`).
 */
async function ensureProjectId(dir: string): Promise<string> {
  const pkg = await readPackage(dir);
  const existing = recordedId(pkg);
  if (existing) return existing;

  const id = nanoid();
  markSelfWrite(dir, "package.json");
  await writePackage(dir, { ...(pkg ?? packageJson(basename(dir), basename(dir))), projectId: id });
  return id;
}

/** package.json `main` when it names a JSX/TS/JS file that exists, else the default lookup. */
async function findEntry(dir: string, pkg?: PackageJson | null): Promise<string | undefined> {
  const main = (pkg ?? (await readPackage(dir)))?.main;
  if (typeof main === "string" && /\.[jt]sx?$/.test(main) && (await exists(join(dir, main)))) {
    return main.split(sep).join("/");
  }
  for (const name of ENTRY_FILES) {
    if (await exists(join(dir, name))) return name;
  }
  return undefined;
}

const noEntryError = (): string =>
  `No entry found in this folder (package.json "main" or ${ENTRY_FILES.join(" / ")}).`;

async function describe(dir: string): Promise<ProjectInfo | null> {
  const pkg = await readPackage(dir);
  const entry = await findEntry(dir, pkg);
  if (!entry) return null;
  const name = basename(dir);
  const [folder, file] = await Promise.all([stat(dir), stat(join(dir, entry))]);
  return {
    id: recordedId(pkg),
    name,
    displayName: pkg?.displayName?.trim() || name,
    dir,
    entry,
    modifiedAt: file.mtime.toISOString(),
    createdAt: folder.birthtime.toISOString(),
  };
}

export const getProject = (dir: string): Promise<ProjectInfo | null> => describe(dir);

/**
 * The folder projects go in when the user has not picked one. `~/Movies` on
 * macOS, `Videos` elsewhere — chosen because it is the one media folder the
 * sync services leave alone: iCloud's "Desktop & Documents Folders" covers
 * only those two, and OneDrive's Known Folder Move only Desktop, Documents,
 * and Pictures. It also needs no macOS permission prompt, which Documents and
 * Desktop do. Created on demand, so a user who never makes a project never
 * gets the folder.
 *
 * Null when it turns out to be synced after all and the user would rather
 * pick somewhere else — the caller falls back to `pickRoot`.
 */
export async function defaultRoot(window: BrowserWindow | null): Promise<string | null> {
  const dir = join(app.getPath("videos"), "Diffusion Studio");
  if (!(await confirmCloudLocation(window, dir, "Choose another folder"))) return null;
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function pickRoot(window: BrowserWindow | null): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: "Choose projects folder",
    defaultPath: app.getPath("videos"),
    properties: ["openDirectory", "createDirectory"],
  };

  // Declining a synced folder reopens the picker rather than dropping the
  // user back to the dashboard: they came here to choose one.
  while (true) {
    const { canceled, filePaths } = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (canceled || !filePaths[0]) return null;
    if (await confirmCloudLocation(window, filePaths[0], "Choose another folder")) {
      return filePaths[0];
    }
  }
}

/**
 * The attribute macOS puts on a folder that a sync service owns. This is what
 * finding a synced folder comes down to: a synced Desktop or Documents is an
 * ordinary directory in the ordinary place — not a symlink, not a mount, and
 * not distinguishable by its path from an unsynced one. The attribute names
 * the service, so it identifies as well as detects.
 */
const FILE_PROVIDER_ATTR = "com.apple.file-provider-domain-id";

/** Domain ids worth naming; any other service syncs under a generic name. */
const FILE_PROVIDERS: Array<[prefix: string, label: string]> = [
  ["com.apple.CloudDocs", "iCloud Drive"],
  ["com.google.drivefs", "Google Drive"],
  ["com.dropbox", "Dropbox"],
  ["com.microsoft.OneDrive", "OneDrive"],
  ["com.box", "Box"],
];

/**
 * `path` with its symlinks resolved. The folder itself need not exist — what
 * gets resolved is the deepest ancestor that does, which is what lets this
 * answer for a root that is about to be created.
 */
async function resolveDeepest(path: string): Promise<string> {
  let head = resolve(path);
  const tail: string[] = [];

  while (true) {
    try {
      return join(await realpath(head), ...tail);
    } catch {
      const parent = dirname(head);
      if (parent === head) return resolve(path);
      tail.unshift(basename(head));
      head = parent;
    }
  }
}

/** `path` and every parent up to the root, deepest first, that exists. */
async function existingAncestors(path: string): Promise<string[]> {
  const found: string[] = [];
  let head = resolve(path);

  while (true) {
    if (await exists(head)) found.push(head);
    const parent = dirname(head);
    if (parent === head) return found;
    head = parent;
  }
}

/**
 * The File Provider domains owning any of `paths`. The attribute sits on the
 * folder the service manages and is not inherited by what is inside it, so
 * the whole ancestor chain is asked at once — a folder deep in a synced
 * Desktop carries nothing itself. Anything that goes wrong is an absence: no
 * attribute, no permission to look, and no `xattr` all read the same, which
 * costs a warning rather than access to the folder.
 */
async function fileProviderDomains(paths: string[]): Promise<string[]> {
  if (process.platform !== "darwin" || !paths.length) return [];

  const stdout = await new Promise<string>((done) => {
    execFile("/usr/bin/xattr", ["-p", FILE_PROVIDER_ATTR, ...paths], (_error, out) =>
      done(out ?? ""),
    );
  });

  const domains: string[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    // One path answers with the bare value, several with `<path>: <value>`.
    if (paths.length === 1) {
      domains.push(line.trim());
      continue;
    }
    const owner = paths.find((candidate) => line.startsWith(candidate + ": "));
    if (owner) domains.push(line.slice(owner.length + 2).trim());
  }
  return domains;
}

/**
 * Whether macOS is syncing the home Desktop and Documents folders. Those two
 * are both the common case and the awkward one: reading their attribute needs
 * a permission the app may not have been granted, and the read fails silently
 * without it. iCloud's own copies of the folders answer the same question,
 * and looking at those needs no permission at all.
 */
async function desktopAndDocumentsSynced(): Promise<boolean> {
  const cloud = join(app.getPath("home"), "Library", "Mobile Documents", "com~apple~CloudDocs");
  return (await exists(join(cloud, "Desktop"))) || (await exists(join(cloud, "Documents")));
}

/** The sync service `path` sits under, or null when it is on plain local disk. */
export async function cloudSyncKind(path: string): Promise<string | null> {
  const real = await resolveDeepest(path);
  const home = app.getPath("home");

  // iCloud Drive itself, and the per-app containers beside it: the one synced
  // thing macOS leaves unmarked, so the only one that goes by path.
  const mobile = await resolveDeepest(join(home, "Library", "Mobile Documents"));
  if (real === mobile || real.startsWith(mobile + sep)) return "iCloud Drive";

  // Windows has no File Provider to ask.
  if (process.platform === "win32") {
    const roots: Array<[string, string]> = [[join(home, "iCloudDrive"), "iCloud Drive"]];
    for (const key of ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]) {
      const dir = process.env[key];
      if (dir) roots.push([dir, "OneDrive"]);
    }
    for (const [dir, label] of roots) {
      const root = resolve(dir);
      if (real === root || real.startsWith(root + sep)) return label;
    }
  }

  // The home Desktop and Documents, before the attribute is asked for: it is
  // the one the app is most likely to be unable to read.
  const under = async (name: "desktop" | "documents") => {
    const root = await resolveDeepest(app.getPath(name));
    return real === root || real.startsWith(root + sep);
  };
  if (((await under("desktop")) || (await under("documents"))) && (await desktopAndDocumentsSynced())) {
    return "iCloud Drive";
  }

  // Everything else: every service with a folder under `Library/CloudStorage`,
  // and anything else macOS hands to a File Provider.
  for (const domain of await fileProviderDomains(await existingAncestors(real))) {
    const known = FILE_PROVIDERS.find(([prefix]) => domain.startsWith(prefix));
    return known ? known[1] : "a cloud sync service";
  }
  return null;
}

/**
 * Whether to go ahead with `path`: true when nothing syncs it, and when the
 * user has been told what syncing does to a project and wants it anyway.
 * Headless runs are never asked — there is nobody to ask — and proceed with
 * the warning in the log.
 */
async function confirmCloudLocation(
  window: BrowserWindow | null,
  path: string,
  declineLabel: string,
): Promise<boolean> {
  const kind = await cloudSyncKind(path);
  if (!kind) return true;

  if (isHeadless()) {
    console.warn(`[projects] ${path} is synced by ${kind}; projects there may misbehave`);
    return true;
  }

  const options: Electron.MessageBoxOptions = {
    type: "warning",
    title: "This folder is synced",
    message: `${kind} syncs this folder.`,
    detail:
      `Projects here are not supported. ` +
      `Expect glitches: edits reappearing after you change them, work lost to ` +
      `a conflicting copy, or the project failing to build.\n\n` +
      `Somewhere on local disk avoids all of this.`,
    buttons: [declineLabel, "Use anyway"],
    defaultId: 0,
    cancelId: 0,
  };

  const { response } = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);
  return response === 1;
}

/** Direct child folders of `root` that could hold a project, in a stable order. */
async function childDirs(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
    .map((entry) => entry.name)
    .sort()
    .map((name) => join(root, name));
}

/** Every direct child folder of `root` that holds an entry file. Reads only. */
export async function listProjects(root: string): Promise<ProjectInfo[]> {
  const dirs = await childDirs(root);
  const projects = await Promise.all(dirs.map(describe));
  return projects.filter((project): project is ProjectInfo => project !== null);
}

/**
 * Where an id was last seen, so opening the project the URL names usually
 * costs one package.json read instead of a scan of the root. Never trusted
 * without rereading the file: a stale entry (folder renamed behind our back,
 * project deleted) just falls through to the scan.
 */
const dirsById = new Map<string, string>();

const cacheKey = (root: string, id: string): string => `${root}\n${id}`;

/** Drops every cached id that pointed at `dir` (it moved, or is gone). */
function forgetDir(dir: string): void {
  for (const [key, cached] of dirsById) {
    if (cached === dir) dirsById.delete(key);
  }
}

/**
 * The project `ref` names under `root`: an id first, then a folder name, so
 * links made before ids existed still open. Whatever is found is left holding
 * an id — this is where a folder that predates them gets one — and the caller
 * can send the app to that id's URL.
 *
 * Ids live in a file the user can copy, so two folders can end up with the
 * same one. Nothing here can tell which was meant, so it settles for being
 * predictable: the cache answers first, so a project stays the one that was
 * already open, and a cold scan is ordered by folder name.
 */
export async function resolveProject(root: string, ref: string): Promise<ProjectInfo | null> {
  if (!ref) return null;

  const found = async (dir: string): Promise<ProjectInfo | null> => {
    dirsById.set(cacheKey(root, await ensureProjectId(dir)), dir);
    return describe(dir);
  };

  const cached = dirsById.get(cacheKey(root, ref));
  if (cached && recordedId(await readPackage(cached)) === ref) {
    const project = await describe(cached);
    if (project) return project;
  }

  let dirs: string[];
  try {
    dirs = await childDirs(root);
  } catch {
    return null;
  }
  const ids = await Promise.all(dirs.map(async (dir) => recordedId(await readPackage(dir))));

  const byId = dirs[ids.indexOf(ref)];
  if (byId) return found(byId);

  const byName = dirs.find((dir) => basename(dir) === ref);
  return byName ? found(byName) : null;
}

// ---------------------------------------------------------------------------
// Scaffold

/** Folder-safe project name: "Golden River 15 Aug" -> "golden-river-15-aug". */
function folderName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 64) || "project"
  );
}

/** `base`, or `base-2`, `base-3`... when the folder is taken. */
async function freeFolder(root: string, base: string): Promise<string> {
  let name = base;
  for (let i = 2; await exists(join(root, name)); i++) name = `${base}-${i}`;
  return name;
}

/** npm names: lowercase, url-safe, no leading dot or underscore, <= 214 chars. */
function packageName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 214);
  return cleaned || "diffusion-project";
}

// Types only: the editor supplies the runtime when it mounts the project.
const JSX_VERSION = () => `^${app.getVersion()}`;
const SOLID_VERSION = "^1.9.10";

/**
 * The dapi surface as npm scripts: the CLI is how a project is inspected and
 * cut, so its commands belong in the record of the project they act on —
 * `npm run` prints the menu, `npm run <name> -- <args>` runs one. Named after
 * the command rather than its path (`grab`, not `media:grab`): the `media`
 * subcommands have no top-level namesakes to collide with.
 */
const SCRIPTS: Record<string, string> = {
  open: "dapi open .",
  context: "dapi context",
  capture: "dapi capture",
  probe: "dapi media probe",
  transcribe: "dapi media transcribe",
  grab: "dapi media grab",
  filmstrip: "dapi media filmstrip",
  waveform: "dapi media waveform",
  listen: "dapi media listen",
  models: "dapi models",
  voices: "dapi voices",
  fonts: "dapi fonts",
  whoami: "dapi whoami",
  logs: "dapi logs",
  screenshot: "dapi screenshot",
  report: "dapi report",
  fetch: "dapi fetch",
};

const packageJson = (name: string, displayName: string): PackageJson => ({
  name: packageName(name),
  projectId: nanoid(),
  displayName,
  private: true,
  type: "module",
  main: "index.tsx",
  scripts: { ...SCRIPTS },
  devDependencies: {
    "@diffusionstudio/jsx": JSX_VERSION(),
    "solid-js": SOLID_VERSION,
  },
});

const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "jsxImportSource": "@diffusionstudio/jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["**/*.ts", "**/*.tsx"]
}
`;

/** What a project folder produces but should not check in: installs, derived data (thumbnails, waveforms), and the app-owned docs. */
const GITIGNORE = `node_modules/
cache/
.diffusion/
`;

const STARTER = `export default function Project() {
  return (
    <stage background="#161616">
    </stage>
  )
}
`;

/**
 * The library a fresh project starts with: empty, but written, so the file the
 * app keeps its assets in is part of the folder from the first open rather
 * than appearing at the first import.
 */
const EMPTY_MANIFEST = { version: 1, folders: [], assets: [] };

/**
 * The project's own README: what the folder holds, how the composition is
 * written, and what can be run against it. Written once like the rest of the
 * scaffold, so from then on it is the author's file to say what this project
 * is.
 */
const readme = (displayName: string): string => `# ${displayName}

A Diffusion Studio project: a video composition authored as code. The folder is
a plain npm package whose entry file is a [Solid](https://www.solidjs.com)
component; the app compiles it and renders every element into an editable node
on the canvas.

## Structure

| Path | What it is |
| ---- | ---------- |
| \`index.tsx\` | The entry. Its default export renders the composition. |
| \`package.json\` | The project record: \`projectId\` (its identity, kept across renames), \`displayName\` (the name shown in the app), \`main\` (the entry), \`diffusion\` (how each scene is exported), and the dapi commands as scripts. |
| \`tsconfig.json\` | Types for the composition tags, through \`jsxImportSource\`. |
| \`assets.yml\` | The asset library: for every asset its library path, where its bytes are, and what it was found to be. Written by the app; hand edits are read on the next load. |
| \`assets/\` | The library's files: put one here and it is taken in while the app watches, and the app writes its own here too — generations under \`assets/generated/\`. Media imported through the app is linked where it lies instead, never copied. |
| \`cache/\` | Derived data (thumbnails, waveforms). Disposable, and not checked in. |
| \`AGENTS.md\` | The agent entry point: what to read in \`.diffusion/docs/\` and how to work here. |
| \`.diffusion/\` | App-owned. \`docs/\` is the authoring reference and examples for the installed app version; the app regenerates it, and it is not checked in. |

## Authoring

The source is the document, in both directions. Saving recompiles the project
and remounts it — scenes rebuild in place, the way reloading a page does, and a
compile error leaves the last good render on the canvas. Edits made in the app
come back the other way: a dragged rect, a trimmed clip or a retyped line lands
as a prop on the element it was authored as.

\`\`\`tsx
export default function Project() {
  return (
    <stage background="#161616" camera={[0.3, 0, 0, 0.3, 85, 150]}>
      <scene name="Intro" width={1920} height={1080} fill="black" active>
        <video src="b-roll/drone.mp4" start={0} end={6} width={1920} height={1080} />
        <text y={860} width={1920} textAlign="center" fontFamily="Inter" fontSize={96} start={1} end={5}>
          Hello
          <animation type="fade" duration={0.5} />
          <animation type="fade" phase="out" duration={0.5} />
        </text>
      </scene>
    </stage>
  )
}
\`\`\`

- \`<stage>\` is the root, and holds one \`<scene>\` per frame you cut in. A scene
  owns the timeline its children sit on; nothing outside a scene has a clock to
  be placed against.
- One scene carries \`active\` — the one the playhead, the timeline and an export
  are pointed at — and the stage carries the \`camera\` the canvas opens on, a
  \`[scale, 0, 0, scale, x, y]\` matrix (\`0.3\` fits a 1920×1080 frame). Both are
  editor state: the app writes them back as the view is panned or a scene is
  clicked, but a project that ships without them opens on an empty timeline,
  looking at the corner of nothing.
- Position and size are explicit, in pixels. There is no layout pass and no CSS.
- \`start\` / \`end\` place a clip on that timeline, \`sourceIn\` / \`sourceOut\` choose
  the part of the media that plays. Times are seconds (\`1.5\`), frames (\`45f\`) or
  \`"MM:SS"\`.
- Style and motion are children: \`<animation>\` for a preset in or out,
  \`<keyframeTrack>\` with \`<keyframe>\` children for one property, \`<solidPaint>\`
  and the gradient paints, \`<stroke>\`, \`<shadow>\`, \`<effect>\`.
- \`src\` takes a library path (\`"b-roll/drone.mp4"\` — the portable form, it
  survives the file being relinked), an asset id, a URL, or an absolute path.
- Generated assets are declared rather than fetched: \`src={generate.image({ prompt })}\`,
  and \`generate.video\`, \`generate.voice\`, \`generate.audio\`. They are produced on
  mount, in dependency order. \`dapi context\` reports where each stands:
  generating, failed with the reason, or done with the asset path it landed as.
- Solid is fully available while mounting: \`<For>\`, \`<Show>\`, \`createMemo\`, and
  \`useTicker()\` for values that follow the playhead.
- npm packages work as they normally do. The folder is a real npm package, so
  \`npm i three\` in it is all it takes: anything in \`node_modules\` is resolved
  and bundled, subpath imports included. A composition runs in a browser
  context, so a package that needs Node APIs will not bundle.

Types are stripped at compile time and never checked, so typecheck the project
yourself with \`npx tsc --noEmit\`.

## Commands

Every dapi command is a script here: \`npm run\` lists them, and
\`npm run <name> -- <args>\` runs one (\`npm run grab -- b-roll/drone.mp4 -c 6\`).
All of them talk to the running app, except \`fonts\` and \`fetch\`.

| Script | Command | What it does |
| ------ | ------- | ------------ |
| \`open\` | \`dapi open .\` | Launch the app with this project open. |
| \`context\` | \`dapi context\` | Which project the app has open, where its playhead sits, its fonts, where its generations stand. |
| \`capture\` | \`dapi capture <id>\` | Render frames of a scene, as an export would, to labelled PNG contact sheets. |
| \`probe\` | \`dapi media probe <id\\|path>\` | Container and per-track metadata, without decoding. |
| \`transcribe\` | \`dapi media transcribe <id\\|path>\` | Timed speech transcript, word by word. |
| \`grab\` | \`dapi media grab <id\\|path>\` | Decode frames of a video to labelled PNG contact sheets. |
| \`filmstrip\` | \`dapi media filmstrip <id\\|path>\` | Thumbnail grid across a window of a video. |
| \`waveform\` | \`dapi media waveform <id\\|path>\` | Loudness over time, with the silences marked. |
| \`listen\` | \`dapi media listen <id\\|path>\` | Ask a multimodal model what is in an audio track. |
| \`models\` | \`dapi models [type]\` | Generation models and their per-model constraints. |
| \`voices\` | \`dapi voices\` | Speech voices for \`generate.voice\`. |
| \`fonts\` | \`dapi fonts\` | Local font families, valid as \`fontFamily\`. |
| \`whoami\` | \`dapi whoami\` | The signed-in account. |
| \`logs\` | \`dapi logs\` | Recent console output from the app. |
| \`screenshot\` | \`dapi screenshot\` | The whole app window as a PNG. |
| \`report\` | \`dapi report <title>\` | File a bug against the editor, with diagnostics attached. |
| \`fetch\` | \`dapi fetch <url>\` | Download a video with yt-dlp (installed separately). |

## Reference

- [JSX reference](https://github.com/diffusionstudio/editor/blob/main/reference/jsx/README.md): elements, timing, paints, generation, captions
- [CLI reference](https://github.com/diffusionstudio/editor/blob/main/reference/README.md): every command, its options and its output
- [Examples](https://github.com/diffusionstudio/editor/tree/main/examples): runnable compositions to read
`;

/**
 * The agent entry point, written once like the README: the file coding agents
 * load without being asked, and therefore the one place a project is reliably
 * discovered from. Loaded into context whole, so it stays a thin index into
 * `.diffusion/docs` rather than the docs themselves — and being the author's
 * file after the first write, an agent can append project conventions to it
 * while the paths it points at stay put.
 */
const AGENTS = `# Authoring this project

A Diffusion Studio project: a video composition authored as code. The entry
(\`index.tsx\`) default-exports a Solid component that renders a \`<stage>\`;
the app compiles it and renders every element into an editable node on the
canvas. The source is the document in both directions: saving recompiles and
remounts the project, and edits made in the app land back in the JSX as props
on the element they were authored as.

## Docs

\`.diffusion/docs/\` holds the authoring reference and runnable examples for
the installed app version. The app regenerates it on version changes: read it,
never edit it, and trust it over memory.

| Read | For |
| ---- | --- |
| \`.diffusion/docs/reference/jsx/README.md\` | The JSX contract — elements, props, pipeline. Start here. |
| \`.diffusion/docs/reference/jsx/timing.md\` | \`start\`/\`end\`/\`sourceIn\`/\`sourceOut\`, and the time formats. |
| \`.diffusion/docs/reference/jsx/generate.md\` | Declaring AI-generated assets (\`generate.*\`). |
| \`.diffusion/docs/reference/README.md\` | Every dapi command, its options and its output. |
| \`.diffusion/docs/examples/\` | Complete compositions, basics through shaders. |

## Working here

- Every dapi command is an npm script: \`npm run\` lists them, and
  \`npm run <name> -- <args>\` runs one.
- \`npm run context\` reports what the app has open, where its playhead sits,
  and where generations stand.
- Verify visually with \`npm run capture -- <sceneId>\`: it renders the
  scene's frames exactly as an export encodes them. Do not export a video to
  check work.
- Position and size are explicit, in pixels. There is no layout pass and no CSS.
- A composition you author from scratch marks one scene \`active\` and gives
  \`<stage>\` a \`camera\` framing it, or the project opens on an empty timeline
  with the frame off screen.
- Times are seconds (\`1.5\`), frames (\`"45f"\`), or \`"MM:SS"\`.
- Types are stripped at compile time, never checked: run \`npx tsc --noEmit\`.
`;

// ---------------------------------------------------------------------------
// Authoring docs

/**
 * The project-relative folder the app owns outright. Everything else the
 * scaffold writes is written once and is the author's from then on; this
 * folder is regenerated wholesale, which is why it gets a namespace of its
 * own instead of files among the author's.
 */
const APP_DIR = ".diffusion";

/** Repo housekeeping that has no business in a project's copy of the docs. */
const DOCS_SKIP = new Set(["tsconfig.json", ".DS_Store"]);

/**
 * Where the shipped docs come from: staged app resources when packaged (see
 * scripts/stage-docs.mjs), the repo checkout in development. Both lay the
 * tree out as the repo does — `reference/` beside `examples/` — so the
 * relative links between the pages keep resolving after the copy.
 */
function docsSources(): string {
  return app.isPackaged ? join(process.resourcesPath, "docs") : join(app.getAppPath(), "..", "..");
}

/**
 * Copies the authoring reference and examples into `.diffusion/docs`, stamped
 * with the app version and refreshed whenever the stamp stops matching. Docs
 * that outlive the app they sit next to would lie about it, so unlike the
 * rest of the scaffold this is rewritten, not written once. The stamp only
 * moves with a release; in development a refresh is forced by deleting the
 * folder. This runs on every compile, so the up-to-date case is one read.
 */
async function syncDocs(dir: string): Promise<void> {
  const docsDir = join(dir, APP_DIR, "docs");
  const stampFile = join(docsDir, ".version");
  const version = app.getVersion();
  try {
    if ((await readFile(stampFile, "utf8")).trim() === version) return;
  } catch {
    // No stamp: never synced, or a copy that did not finish. Full copy below.
  }
  const source = docsSources();
  await rm(docsDir, { recursive: true, force: true });
  await mkdir(docsDir, { recursive: true });
  for (const name of ["reference", "examples"]) {
    const src = join(source, name);
    if (!(await exists(src))) continue;
    await cp(src, join(docsDir, name), {
      recursive: true,
      filter: (path) => !DOCS_SKIP.has(basename(path)),
    });
  }
  // Written last, so a copy that died refuses to pass for a synced one.
  await writeFile(stampFile, version + "\n", "utf8");
}

async function writeIfMissing(dir: string, name: string, content: string): Promise<void> {
  const path = join(dir, name);
  if (await exists(path)) return;
  await writeFile(path, content, "utf8");
}

/** Adds the record fields to a package.json that predates them; leaves everything else alone. */
async function ensurePackage(dir: string, name: string, displayName: string, entry: string): Promise<void> {
  const pkg = await readPackage(dir);
  if (!pkg) {
    await writePackage(dir, { ...packageJson(name, displayName), main: entry });
    return;
  }
  const next = { ...pkg };
  if (!recordedId(next)) next.projectId = nanoid();
  if (typeof next.displayName !== "string") next.displayName = displayName;
  if (typeof next.main !== "string") next.main = entry;
  // The commands are a menu rather than a record: a project that keeps its own
  // scripts is left with them, one with none is given the dapi surface.
  if (typeof next.scripts !== "object" || next.scripts === null) next.scripts = { ...SCRIPTS };
  if (
    next.projectId !== pkg.projectId ||
    next.displayName !== pkg.displayName ||
    next.main !== pkg.main ||
    next.scripts !== pkg.scripts
  ) {
    markSelfWrite(dir, "package.json");
    await writePackage(dir, next);
  }
}

/**
 * Turns `dir` into a starter TypeScript project: files the project owns are
 * written once, so opening an up-to-date project writes nothing. Types come
 * from @diffusionstudio/jsx (jsxImportSource), installed by the project.
 */
export async function scaffold(dir: string, displayName = basename(dir)): Promise<void> {
  const name = basename(dir);
  let entry = await findEntry(dir);
  // JavaScript projects are left alone.
  if (entry && !/\.tsx?$/.test(entry)) return;

  if (!entry) {
    await writeIfMissing(dir, "index.tsx", STARTER);
    entry = "index.tsx";
  }
  await ensurePackage(dir, name, displayName, entry);
  await writeIfMissing(dir, "tsconfig.json", TSCONFIG);
  await writeIfMissing(dir, ".gitignore", GITIGNORE);
  await writeIfMissing(dir, "README.md", readme(displayName));
  await writeIfMissing(dir, "AGENTS.md", AGENTS);

  // The docs are auxiliary: a project must still open and compile without
  // them, so a failed sync is a warning rather than a failed scaffold.
  try {
    await syncDocs(dir);
  } catch (error) {
    console.warn(`projects: could not sync the authoring docs into ${dir}`, error);
  }

  if (!(await exists(join(dir, MANIFEST_FILE)))) {
    await writeManifest(dir, EMPTY_MANIFEST);
  }
}

/**
 * Makes `dir` openable as a project, writing as little as that takes: the
 * folder if it does not exist, and — when nothing in it can be an entry — an
 * `index.tsx` holding an empty stage. Nothing else; a project is its JSX, and
 * the record, manifest, and the rest of the scaffold appear lazily, each when
 * something first needs it. A folder that is already a project comes back
 * untouched. How `dapi open <path>` opens a folder anywhere on disk.
 */
export async function initProject(window: BrowserWindow | null, dir: string): Promise<ProjectInfo> {
  if (!(await confirmCloudLocation(window, dir, "Cancel"))) {
    throw new Error("Cancelled: that folder is synced.");
  }

  await mkdir(dir, { recursive: true });
  if (!(await findEntry(dir))) {
    await writeIfMissing(dir, "index.tsx", STARTER);
  }
  const project = await describe(dir);
  if (!project) throw new Error(noEntryError());
  return project;
}

/**
 * Creates a fresh project folder under `root`, named after `displayName`. A
 * taken name is numbered rather than refused: the folder is a label, the id
 * inside it is the project.
 */
export async function createProject(root: string, displayName: string): Promise<ProjectInfo> {
  const dir = join(root, await freeFolder(root, folderName(displayName)));
  await mkdir(dir, { recursive: true });
  await scaffold(dir, displayName);
  const project = await describe(dir);
  if (!project) throw new Error("Failed to scaffold the project.");
  return project;
}

/**
 * Renames the project: the human name in the record, and the folder with it,
 * so what the user sees in Finder keeps matching what they see in the app.
 * This is the only thing here that moves a folder — nothing syncs the two
 * behind the user's back — and it costs the project neither its identity nor
 * its links, both of which are the id.
 */
export async function renameProject(dir: string, displayName: string): Promise<ProjectInfo> {
  const pkg = (await readPackage(dir)) ?? packageJson(basename(dir), displayName);
  const name = displayName.trim() || basename(dir);
  markSelfWrite(dir, "package.json");
  await writePackage(dir, { ...pkg, displayName: name });

  const project = await describe(await renameFolder(dir, name));
  if (!project) throw new Error("Not a project folder.");
  return project;
}

/**
 * Moves the project folder to match `displayName`; answers where it ended up.
 * Best effort by design: the folder can be locked, open elsewhere, or on a
 * volume that will not have it, and none of that should cost the user the
 * name they just typed.
 */
async function renameFolder(dir: string, displayName: string): Promise<string> {
  const root = dirname(dir);
  const base = folderName(displayName);
  const current = basename(dir);
  // Already named after it, numbered suffix and all: moving `my-clip-2` to
  // `my-clip` (or to `my-clip-3`) shuffles folders that are equally right.
  if (current === base || (current.startsWith(`${base}-`) && /^\d+$/.test(current.slice(base.length + 1)))) {
    return dir;
  }

  try {
    const target = join(root, await freeFolder(root, base));
    // The watcher holds the old path, and the renderer re-watches the new one
    // as soon as it hears where the project went.
    unwatchProject(dir);
    await rename(dir, target);
    forgetDir(dir);
    return target;
  } catch {
    return dir;
  }
}

/** Copies the folder next to itself as `<name>-copy` (numbered when taken). */
export async function duplicateProject(dir: string): Promise<ProjectInfo> {
  const source = await describe(dir);
  if (!source) throw new Error("Not a project folder.");

  const root = dirname(dir);
  const target = join(root, await freeFolder(root, `${source.name}-copy`));

  await cp(dir, target, { recursive: true, errorOnExist: true, force: false });
  // The record came along with everything else, id included, and two folders
  // answering to one id is the thing the id exists to prevent. The folder is
  // already named for the copy, so the record is written here rather than
  // through `renameProject` (which would move it again).
  const pkg = await readPackage(target);
  await writePackage(target, {
    ...(pkg ?? packageJson(basename(target), source.displayName)),
    projectId: nanoid(),
    displayName: `${source.displayName} (Copy)`,
  });
  const project = await describe(target);
  if (!project) throw new Error("Failed to duplicate the project.");
  return project;
}

/** Moves the folder to the trash. */
export async function deleteProject(dir: string): Promise<void> {
  unwatchProject(dir);
  await shell.trashItem(dir);
  forgetDir(dir);
}

// ---------------------------------------------------------------------------
// Compile

type Babel = typeof import("@babel/core");
type Esbuild = typeof import("esbuild");

/** A preset however its package exposes it (CJS `module.exports` or an ESM default). */
function preset(name: string): unknown {
  const loaded = load<{ default?: unknown }>(name);
  return loaded.default ?? loaded;
}

const babelOptions = (file: string, filename: string): TransformOptions => ({
  filename,
  babelrc: false,
  configFile: false,
  // Runs before the presets, which is what it needs: Solid's transform
  // replaces the JSX trees this stamps.
  plugins: [[sourcePlugin, { file }], canonicalizeTagsPlugin],
  presets: [
    [preset("babel-preset-solid"), { generate: "universal", moduleName: RUNTIME_MODULE }],
    [preset("@babel/preset-typescript"), { onlyRemoveTypeImports: true }],
  ],
});

/** Runs project sources (not node_modules) through Solid's universal JSX transform. */
function solidLoader(root: string): Plugin {
  const { transformAsync } = load<Babel>("@babel/core");
  return {
    name: "solid-universal",
    setup(build) {
      build.onLoad({ filter: /\.[jt]sx?$/ }, async (args) => {
        const name = relative(root, args.path);
        if (name.startsWith("..") || name.includes(`${sep}node_modules${sep}`) || name.startsWith(`node_modules${sep}`)) {
          return undefined;
        }
        const source = await readFile(args.path, "utf8");
        // The project-relative name is half of every element's id, so it is
        // spelled the one way both directions of ./source spell it.
        const result = await transformAsync(source, babelOptions(name.split(sep).join("/"), args.path));
        return { contents: result?.code ?? "", loader: "js" };
      });
    },
  };
}

/** The `./edit` context for a project folder, wired to the watcher's self-write log. */
const sourceContext = (dir: string): SourceContext => ({
  dir,
  onWrite: (file) => markSelfWrite(dir, file),
});

export async function compileProject(dir: string): Promise<CompileResult> {
  const entry = await findEntry(dir);
  if (!entry) return { ok: false, error: noEntryError() };

  // Fills in package.json/tsconfig for folders that predate the record.
  await scaffold(dir);

  // Names every element before it is numbered, so the ids this compile hands
  // the canvas are durable ones. A fully keyed project is not written to.
  await stampProject(sourceContext(dir));

  // esbuild resolves symlinks, so the loader has to match on real paths.
  const root = await realpath(dir);

  try {
    const { build } = load<Esbuild>("esbuild");
    const result = await build({
      ...BUILD_OPTIONS,
      entryPoints: [join(root, entry)],
      plugins: [solidLoader(root)],
    });
    return { ok: true, code: result.outputFiles![0]!.text };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// Write

/**
 * Writes values the editor arrived at back into the JSX that produced them.
 * Deliberately not a compile: the canvas already shows these values, so this
 * is the file catching up with the scene rather than the other way round, and
 * the watcher is told to keep quiet about it (see `markSelfWrite`).
 */
export async function writeProject(dir: string, edits: SourceEdit[]): Promise<WriteResult> {
  try {
    return await applyEdits(sourceContext(dir), edits);
  } catch (error) {
    return { skipped: edits.map((edit) => edit.source), error: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// Assets

/** The asset manifest's file name. */
export const MANIFEST_FILE = "assets.yml";

/**
 * A `source` of the asset library as an absolute path: absolute already, or
 * relative to the project. Refuses to leave the project for a relative one.
 */
function sourcePath(dir: string, source: string): string {
  if (isAbsolute(source)) return source;
  const path = resolve(dir, source);
  if (relative(dir, path).startsWith("..")) throw new Error(`Path leaves the project: ${source}`);
  return path;
}

/** The manifest as plain data, or null when the project has none. */
export async function readManifest(dir: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(join(dir, MANIFEST_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return parseYaml(text) ?? null;
}

/**
 * Writes the manifest as YAML. Atomic (temp file + rename), so a crash
 * mid-write leaves the old manifest, and marked as ours so the watcher does
 * not hand it back as a change.
 */
export async function writeManifest(dir: string, manifest: unknown): Promise<void> {
  const path = join(dir, MANIFEST_FILE);
  const temp = join(dir, `.${MANIFEST_FILE}.tmp`);
  const text = stringifyYaml(manifest, { lineWidth: 0 });
  markSelfWrite(dir, MANIFEST_FILE);
  markSelfWrite(dir, `.${MANIFEST_FILE}.tmp`);
  await writeFile(temp, `# Diffusion Studio asset library. Edited by the app; hand edits are read on the next load.
${text}`, "utf8");
  await rename(temp, path);
}

// ---------------------------------------------------------------------------
// Config

/** The package.json field the project's config lives under. */
const CONFIG_FIELD = "diffusion";

/** The project's config (package.json `diffusion`), or null when there is none. */
export async function readConfig(dir: string): Promise<unknown> {
  const pkg = await readPackage(dir);
  return pkg?.[CONFIG_FIELD] ?? null;
}

/**
 * Replaces the project's config in its package.json (removes the field for
 * null), leaving the rest of the record alone. The watcher is told to keep
 * quiet about it, like the manifest: the app already shows these values.
 */
export async function writeConfig(dir: string, config: unknown): Promise<void> {
  const pkg = (await readPackage(dir)) ?? packageJson(basename(dir), basename(dir));
  const next: PackageJson = { ...pkg };
  if (config === null || config === undefined) delete next[CONFIG_FIELD];
  else next[CONFIG_FIELD] = config;
  markSelfWrite(dir, "package.json");
  await writePackage(dir, next);
}

/** Entries of a directory; [] when it is missing or not a directory. */
export async function listEntries(dir: string, source: string): Promise<FsEntry[]> {
  const path = sourcePath(dir, source);
  let names: import("node:fs").Dirent[];
  try {
    names = await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
  const entries = await Promise.all(names.map(async (entry): Promise<FsEntry | null> => {
    // Symlinks count as whatever they point at, so media linked into `assets/`
    // is listed like a file that sits there. A broken link stats away to null.
    if (!entry.isFile() && !entry.isDirectory() && !entry.isSymbolicLink()) return null;
    try {
      const info = await stat(join(path, entry.name));
      if (!info.isFile() && !info.isDirectory()) return null;
      return {
        name: entry.name,
        kind: info.isDirectory() ? "directory" : "file",
        size: info.size,
        mtime: info.mtimeMs,
        // What a link points at may be anywhere, including somewhere the
        // caller is already inside; `realPathEntry` is how it finds out.
        ...(entry.isSymbolicLink() ? { link: true } : {}),
      };
    } catch {
      return null;
    }
  }));
  return entries.filter((entry): entry is FsEntry => entry !== null);
}

/** Size and mtime of a file, or null when it does not exist. */
export async function statEntry(dir: string, source: string): Promise<FsStat | null> {
  try {
    const info = await stat(sourcePath(dir, source));
    return { size: info.size, mtime: info.mtimeMs };
  } catch {
    return null;
  }
}

/**
 * Where `source` really is, symlinks resolved; null when it does not exist.
 * What a scan of `assets/` asks to tell a link that doubles back — one
 * pointing at a folder the scan is already inside — from an ordinary one.
 */
export async function realPathEntry(dir: string, source: string): Promise<string | null> {
  try {
    return await realpath(sourcePath(dir, source));
  } catch {
    return null;
  }
}

/**
 * Removes a file or directory inside the project; missing is fine.
 *
 * A symlink is removed as itself: the link goes and the media it points at
 * stays, which is what makes taking a linked asset out of the library cost
 * nothing. What lies *behind* a link is not the project's to delete, though —
 * the files inside a linked folder are the user's originals, and `rm` would
 * follow the link and take them off the disk for good. So anything whose real
 * place is outside the project is refused.
 */
export async function removeEntry(dir: string, path: string): Promise<void> {
  if (isAbsolute(path)) throw new Error("Only project files can be removed");
  const target = sourcePath(dir, path);

  let root: string;
  let real: string;
  try {
    root = await realpath(dir);
    // The link itself, not what it resolves to: only the folders above it are
    // followed, so a link inside the project stays inside it.
    real = join(await realpath(dirname(target)), basename(target));
  } catch {
    return; // Nothing holding it, so nothing to remove.
  }
  const rel = relative(root, real);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Refusing to remove ${path}: it really lives outside the project`);
  }

  markSelfWrite(dir, path.split(sep).join("/"));
  await rm(target, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Watch

const watchers = new Map<string, FSWatcher>();

/** How long a file we wrote ourselves stays exempt from the watcher. */
const SELF_WRITE_GRACE = 1000;

/**
 * Writes made on behalf of the editor, by file and time. The watcher stays on
 * — anything else may be editing these files, and should still reach the
 * canvas — but our own writes must not come back as a change, or every key
 * stamp and every dragged rect would cost a recompile and a remount of the
 * scene the user is looking at.
 */
const selfWrites = new Map<string, number>();

const writeKey = (dir: string, path: string): string => `${dir}\n${path}`;

export function markSelfWrite(dir: string, path: string): void {
  selfWrites.set(writeKey(dir, path), Date.now());
}

/** `markSelfWrite` for an absolute path, against whichever watched project holds it. */
export function markSelfWriteAbsolute(path: string): void {
  for (const dir of watchers.keys()) {
    const rel = relative(dir, path);
    if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
      markSelfWrite(dir, rel.split(sep).join("/"));
    }
  }
}

function isSelfWrite(dir: string, path: string): boolean {
  const key = writeKey(dir, path);
  const at = selfWrites.get(key);
  if (at === undefined) return false;
  if (Date.now() - at > SELF_WRITE_GRACE) {
    selfWrites.delete(key);
    return false;
  }
  return true;
}

export function watchProject(window: BrowserWindow | null, dir: string): void {
  if (watchers.has(dir)) return;
  const watcher = watch(dir, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    // Project-relative and `/`-separated; installs churn node_modules constantly.
    const path = filename.split(sep).join("/");
    if (path.startsWith("node_modules/") || path === "node_modules") return;
    // The app's folder: a docs refresh writes the whole tree in one burst.
    if (path.startsWith(`${APP_DIR}/`) || path === APP_DIR) return;
    if (isSelfWrite(dir, path)) return;
    mainBridge.emit(window, MAIN_CHANNELS.PROJECTS_CHANGED, { dir, path });
  });
  watcher.on("error", () => unwatchProject(dir));
  watchers.set(dir, watcher);
}

export function unwatchProject(dir: string): void {
  watchers.get(dir)?.close();
  watchers.delete(dir);
}

export function unwatchAll(): void {
  for (const dir of [...watchers.keys()]) unwatchProject(dir);
}
