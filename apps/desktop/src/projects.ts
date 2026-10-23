/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { app, dialog, shell, type BrowserWindow } from "electron";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { cp, mkdir, readdir, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { nanoid } from "nanoid";
import { MCP_URL } from "@diffusionstudio/dapi";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type { PluginItem, TransformOptions } from "@babel/core";
import type { BuildOptions, Plugin } from "esbuild";

import { countCodeChange } from "./analytics";
import { isTempPath, TEMP_PREFIX, writeFileAtomic } from "./atomic";
import { windowsCloudSyncKind } from "./cloud-sync-windows";
import { mainBridge } from "./main-manager";
import { MAIN_CHANNELS } from "./main-channels";
import { applyEdits, editLabel, stampProject } from "./edit";
import { migrateGenerations } from "./legacy-generations";
import { canonicalizeTagsPlugin, inspectPlugin, sourcePlugin } from "./source";
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
// app has no node_modules of its own, so they load from the staged runtime at
// Contents/Resources/runtime/node_modules (see scripts/stage-runtime.mjs).
let stagedRequire: NodeJS.Require | undefined;

function load<T>(name: string): T {
  if (!app.isPackaged) return require(name) as T;
  stagedRequire ??= createRequire(join(process.resourcesPath, "runtime", "package.json"));
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
  const path = join(dir, "package.json");
  const text = JSON.stringify(pkg, null, 2) + "\n";
  // The record is read by the app, by the watcher and by whatever else has the
  // folder open, so it is claimed and replaced whole (see `noteContent`).
  noteContent(path, text);
  await writeFileAtomic(path, text);
}

// ---------------------------------------------------------------------------
// Identity

// A project is named twice: `displayName` is what the user calls it and the
// folder is what the disk calls it, and either can change apart from the
// other (the app renames the one, the user moves the other). Neither can be
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
    draft: isDraft(dir),
  };
}

export const getProject = (dir: string): Promise<ProjectInfo | null> => describe(dir);

// ---------------------------------------------------------------------------
// Drafts

// A new project starts as a draft: a folder the app makes without asking,
// in a place of its own, named after the id. Saving it (⌘S) is when the user
// says where it goes and what the folder is called — the folder moves there,
// and from then on it is an ordinary project.

/**
 * The folder drafts live in. Inside the app's own data, which nothing syncs —
 * neither iCloud nor OneDrive reaches `Application Support` or `AppData` —
 * and which needs no permission prompt. On Windows the Local AppData rather
 * than the Roaming one, which a roaming profile would carry, media and all,
 * from machine to machine.
 */
export function draftsRoot(): string {
  const local = process.platform === "win32" ? process.env.LOCALAPPDATA : undefined;
  const base = local ? join(local, basename(app.getPath("userData"))) : app.getPath("userData");
  return join(base, "Drafts");
}

/** Whether `dir` is a draft's folder: directly inside `draftsRoot`. */
function isDraft(dir: string): boolean {
  const parent = dirname(resolve(dir));
  const root = draftsRoot();
  return process.platform === "win32" ? parent.toLowerCase() === root.toLowerCase() : parent === root;
}

/**
 * Where the save picker starts when no project has been saved yet: a folder
 * under `~/Movies` on macOS, `Videos` elsewhere — the one media folder the
 * sync services leave alone (iCloud's "Desktop & Documents Folders" covers
 * only those two, OneDrive's Known Folder Move only Desktop, Documents, and
 * Pictures), and one that needs no macOS permission prompt. Created on
 * demand, so a user who never saves a project never gets the folder.
 */
async function defaultSaveFolder(): Promise<string> {
  const dir = join(app.getPath("videos"), "Diffusion Studio");
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Characters no folder name can hold on one platform or another. */
const UNSAFE_NAME = /[\\/:*?"<>|]+/g;

/** Why the project in `dir` cannot be saved or moved as `target`, or null when it can. */
async function saveProblem(dir: string, target: string): Promise<string | null> {
  if (await exists(target)) {
    return `"${basename(target)}" already exists in ${basename(dirname(target))}. Choose another name.`;
  }
  const inside = relative(resolve(dir), resolve(target));
  if (!inside.startsWith("..") && !isAbsolute(inside)) return "A project can't be saved inside itself.";
  if (isDraft(target)) return "Choose a folder outside the drafts folder.";
  return null;
}

/** What the save picker is asked for: saving a draft, or moving a saved project. */
export type SaveAction = "save" | "move";

/**
 * Asks where to save the draft in `dir`, or where to move the project there:
 * the folder it will become, or null when the user cancels. Starts in
 * `startIn` — the parent of the last project saved — with `name` filled in.
 * A name that is taken is refused rather than replaced, and a synced folder
 * is warned about; either way the picker comes back, since the user came here
 * to save.
 */
export async function pickSaveLocation(
  window: BrowserWindow | null,
  dir: string,
  name: string,
  startIn: string | null,
  action: SaveAction = "save",
): Promise<string | null> {
  const start = startIn && (await stat(startIn).catch(() => null))?.isDirectory() ? startIn : await defaultSaveFolder();
  const folder = name.replace(UNSAFE_NAME, "-").trim() || basename(dir);
  const options: Electron.SaveDialogOptions = {
    title: action === "move" ? "Move project" : "Save project",
    buttonLabel: action === "move" ? "Move" : "Save",
    defaultPath: join(start, folder),
    properties: ["createDirectory", "showOverwriteConfirmation"],
  };

  while (true) {
    const { canceled, filePath } = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    if (canceled || !filePath) return null;
    options.defaultPath = filePath;

    const problem = await saveProblem(dir, filePath);
    if (problem) {
      const message: Electron.MessageBoxOptions = {
        type: "warning",
        message: action === "move" ? "Can't move here" : "Can't save here",
        detail: problem,
      };
      if (window) await dialog.showMessageBox(window, message);
      else await dialog.showMessageBox(message);
      continue;
    }
    if (await confirmCloudLocation(window, filePath, "Choose another folder")) return filePath;
  }
}

/**
 * A folder to open as a single project, wherever it lives. It does not vet
 * the location: the folder goes through `initProject`, which asks about a
 * synced one there.
 */
export async function pickFolder(window: BrowserWindow | null): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: "Choose project folder",
    defaultPath: app.getPath("videos"),
    properties: ["openDirectory", "createDirectory"],
  };

  const { canceled, filePaths } = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  return canceled ? null : filePaths[0] ?? null;
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

  // Windows has no File Provider to ask; everything below is macOS.
  if (process.platform === "win32") return windowsCloudSyncKind(real, home);

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
 * Nobody is asked while the window is hidden — an agent is driving and there
 * is nobody to ask — and the project goes ahead with the warning in the log.
 */
async function confirmCloudLocation(
  window: BrowserWindow | null,
  path: string,
  declineLabel: string,
): Promise<boolean> {
  const kind = await cloudSyncKind(path);
  if (!kind) return true;

  if (!window?.isVisible()) {
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

/**
 * The project `id` in a folder beside `dir`, which no longer holds it: one
 * renamed in Finder, or moved to another folder next to it. Found by the id in
 * its record, which goes wherever the folder goes. Null when no sibling holds
 * it, or `dir`'s parent is gone too. Reads only.
 */
export async function findMovedProject(dir: string, id: string): Promise<ProjectInfo | null> {
  if (!id) return null;
  const parent = dirname(dir);
  let entries;
  try {
    entries = await readdir(parent, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const candidate = join(parent, entry.name);
    if (recordedId(await readPackage(candidate)) === id) return describe(candidate);
  }
  return null;
}

/** What the user wants done about a project whose folder can't be found. */
export type MissingProjectChoice = "locate" | "remove" | "cancel";

/** Tells the user the project's folder is gone, and asks what to do about it. */
export async function askAboutMissingProject(
  window: BrowserWindow | null,
  displayName: string,
  dir: string,
): Promise<MissingProjectChoice> {
  const options: Electron.MessageBoxOptions = {
    type: "warning",
    message: `Can't find "${displayName}"`,
    detail: `It was in ${dir}. It may have been moved, renamed or deleted, or be on a disk that isn't connected.`,
    buttons: ["Locate...", "Remove from List", "Cancel"],
    defaultId: 0,
    cancelId: 2,
  };
  const { response } = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);
  if (response === 0) return "locate";
  if (response === 1) return "remove";
  return "cancel";
}

/**
 * The project in `dir`, left holding an id — this is where a folder that
 * predates ids, or was made by hand, gets one — so the caller can send the
 * app to that id's URL. What the app calls when it opens a project; null
 * when `dir` holds none.
 */
export async function resolveProject(dir: string): Promise<ProjectInfo | null> {
  const project = await describe(dir);
  if (!project || project.id) return project;
  await ensureProjectId(dir);
  return describe(dir);
}

// ---------------------------------------------------------------------------
// Scaffold

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
const JSX_VERSION = "latest";
const SOLID_VERSION = "^1.9.10";

/**
 * The diffusion surface as npm scripts: the CLI is how a project is inspected and
 * cut, so its commands belong in the record of the project they act on —
 * `npm run` prints the menu, `npm run <name> -- <args>` runs one, named after
 * the command.
 */
const SCRIPTS: Record<string, string> = {
  open: "diffusion open .",
  context: "diffusion context",
  capture: "diffusion capture",
  probe: "diffusion probe",
  transcribe: "diffusion transcribe",
  grab: "diffusion grab",
  filmstrip: "diffusion filmstrip",
  waveform: "diffusion waveform",
  listen: "diffusion listen",
  fonts: "diffusion fonts",
  logs: "diffusion logs",
  screenshot: "diffusion screenshot",
  report: "diffusion report",
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
    "@diffusionstudio/jsx": JSX_VERSION,
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

/** What a project folder produces but should not check in: installs, derived data (thumbnails, waveforms), and the app-owned folder. */
const GITIGNORE = `node_modules/
cache/
.diffusion/
${TEMP_PREFIX}*
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

## Agents

Everything an agent needs is in the app's MCP server (\`diffusion\`): its tools
are the API, its instructions say how to work, and its resources are the
authoring reference for the installed version. If it is not among your tools,
add it — the app serves it at \`${MCP_URL}\` while it is running — and start
a new session.

## Structure

| Path | What it is |
| ---- | ---------- |
| \`index.tsx\` | The entry. Its default export renders the composition. |
| \`package.json\` | The project record: \`projectId\` (its identity, kept across renames), \`displayName\` (the name shown in the app), \`main\` (the entry), \`diffusion\` (how each scene is exported, and whether the stage has ever had anything on it), and the diffusion commands as scripts. |
| \`tsconfig.json\` | Types for the composition tags, through \`jsxImportSource\`. |
| \`assets.yml\` | The asset library: for every asset its library path, where its bytes are, and what it was found to be. Written by the app; hand edits are read on the next load. |
| \`assets/\` | The library's files: put one here and it is taken in while the app watches, and the app writes its own here too. Media imported through the app is linked where it lies instead, never copied. |
| \`cache/\` | Derived data (thumbnails, waveforms). Disposable, and not checked in. |

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
- Solid is fully available while mounting: \`<For>\`, \`<Show>\`, \`createMemo\`, and
  \`useTicker()\` for values that follow the playhead.
- npm packages work as they normally do. The folder is a real npm package, so
  \`npm i three\` in it is all it takes: anything in \`node_modules\` is resolved
  and bundled, subpath imports included. A composition runs in a browser
  context, so a package that needs Node APIs will not bundle.

Types are stripped at compile time and never checked, so typecheck the project
yourself with \`npx tsc --noEmit\`.

## Commands

Every diffusion command is a script here: \`npm run\` lists them, and
\`npm run <name> -- <args>\` runs one (\`npm run grab -- b-roll/drone.mp4 -c 6\`).
All of them talk to the running app, except \`fonts\`.

| Script | Command | What it does |
| ------ | ------- | ------------ |
| \`open\` | \`diffusion open .\` | Launch the app with this project open. |
| \`context\` | \`diffusion context\` | Which project the app has open, where its playhead sits, its fonts, its background mask tracks. |
| \`capture\` | \`diffusion capture <id>\` | Render frames of a scene, as an export would, to labelled PNG contact sheets. |
| \`probe\` | \`diffusion probe <id\\|path>\` | Container and per-track metadata, without decoding. |
| \`transcribe\` | \`diffusion transcribe <id\\|path>\` | Timed speech transcript, word by word. |
| \`grab\` | \`diffusion grab <id\\|path>\` | Decode frames of a video to labelled PNG contact sheets. |
| \`filmstrip\` | \`diffusion filmstrip <id\\|path>\` | Thumbnail grid across a window of a video. |
| \`waveform\` | \`diffusion waveform <id\\|path>\` | Loudness over time, with the silences marked. |
| \`listen\` | \`diffusion listen <id\\|path>\` | Ask a multimodal model what is in an audio track. |
| \`fonts\` | \`diffusion fonts\` | Google Fonts and local font families, valid as \`fontFamily\`. |
| \`logs\` | \`diffusion logs\` | Recent console output from the app. |
| \`screenshot\` | \`diffusion screenshot\` | The whole app window as a PNG. |
| \`report\` | \`diffusion report <title>\` | File a bug against the editor, with diagnostics attached. |

## Reference

- [JSX reference](https://github.com/diffusionstudio/editor/blob/main/docs/reference/jsx/README.md): elements, timing, paints, captions
- [Tool reference](https://github.com/diffusionstudio/editor/blob/main/docs/reference/tools/README.md): every tool and command, its options and its output
- [Examples](https://github.com/diffusionstudio/editor/tree/main/docs/examples): runnable compositions to read
`;

// ---------------------------------------------------------------------------
// The app-owned folder

/**
 * The project-relative folder the app owns outright, ignored by git and by
 * the project watcher. Earlier versions copied the authoring docs into it;
 * the docs now live in the app's MCP server.
 */
const APP_DIR = ".diffusion";

async function writeIfMissing(dir: string, name: string, content: string): Promise<void> {
  const path = join(dir, name);
  if (await exists(path)) return;
  noteContent(path, content);
  await writeFileAtomic(path, content);
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
  // scripts is left with them, one with none is given the diffusion surface.
  if (typeof next.scripts !== "object" || next.scripts === null) next.scripts = { ...SCRIPTS };
  if (
    next.projectId !== pkg.projectId ||
    next.displayName !== pkg.displayName ||
    next.main !== pkg.main ||
    next.scripts !== pkg.scripts
  ) {
    await writePackage(dir, next);
  }
}

/**
 * Turns `dir` into a starter TypeScript project: files the project owns are
 * written once, so opening an up-to-date project writes nothing. Types come
 * from @diffusionstudio/jsx (jsxImportSource), installed by the project.
 */
export async function scaffold(dir: string, displayName = basename(dir)): Promise<void> {
  const entry = await ensureRecord(dir, displayName);
  // JavaScript projects are left alone.
  if (!entry) return;
  await writeIfMissing(dir, "tsconfig.json", TSCONFIG);
  await writeIfMissing(dir, ".gitignore", GITIGNORE);
  await writeIfMissing(dir, "README.md", readme(displayName));

  if (!(await exists(join(dir, MANIFEST_FILE)))) {
    await writeManifest(dir, EMPTY_MANIFEST);
  }
}

/**
 * The part of the scaffold every project needs: an entry file, and the
 * package.json record (`projectId`, `displayName`, `main`) the app remembers
 * the folder by. Nothing a folder already has is touched. Returns the entry,
 * or undefined for a JavaScript project, which is left entirely alone.
 */
async function ensureRecord(dir: string, displayName = basename(dir)): Promise<string | undefined> {
  let entry = await findEntry(dir);
  if (entry && !/\.tsx?$/.test(entry)) return undefined;
  if (!entry) {
    await writeIfMissing(dir, "index.tsx", STARTER);
    entry = "index.tsx";
  }
  await ensurePackage(dir, basename(dir), displayName, entry);
  return entry;
}

/**
 * Makes `dir` openable as a project, writing as little as that takes: the
 * folder if it does not exist, an `index.tsx` holding an empty stage when
 * nothing in it can be an entry, and the package.json record the app
 * remembers the folder by. Nothing else — no tsconfig, README, or
 * .gitignore, which come with a project created from the dashboard (see
 * `scaffold`); a folder opened from anywhere on disk stays the user's. A
 * folder that is already a project comes back untouched. How
 * `diffusion open <path>` opens a folder.
 */
export async function initProject(window: BrowserWindow | null, dir: string): Promise<ProjectInfo> {
  if (!isAbsolute(dir)) {
    throw new Error(`The project folder must be an absolute path (got "${dir}").`);
  }
  const existing = await stat(dir).catch(() => null);
  if (existing && !existing.isDirectory()) {
    throw new Error(`${dir} exists but is not a folder.`);
  }
  if (!(await confirmCloudLocation(window, dir, "Cancel"))) {
    throw new Error("Cancelled: that folder is synced.");
  }

  await mkdir(dir, { recursive: true });
  await ensureRecord(dir);
  const project = await describe(dir);
  if (!project) throw new Error(noEntryError());
  return project;
}

/** What a new project is called until it is saved under a name of the user's. */
const DRAFT_NAME = "Untitled";

/**
 * Creates a fresh project as a draft: a folder in `draftsRoot` named after
 * the id it is given here, so creating one asks nothing. `saveProject` is
 * what gives it a place and a name of the user's choosing.
 */
export async function createProject(): Promise<ProjectInfo> {
  const id = nanoid();
  const dir = join(draftsRoot(), id);
  await mkdir(dir, { recursive: true });
  // The record first, so the scaffold keeps the id the folder is named after.
  await writePackage(dir, { ...packageJson(DRAFT_NAME, DRAFT_NAME), projectId: id });
  await scaffold(dir, DRAFT_NAME);
  const project = await describe(dir);
  if (!project) throw new Error("Failed to scaffold the project.");
  return project;
}

/**
 * Renames the project: the human name in the record, and nothing else. The
 * folder keeps its name — moving it is the user's to do, by hand — and the id
 * the project goes by is untouched either way.
 */
export async function renameProject(dir: string, displayName: string): Promise<ProjectInfo> {
  const pkg = (await readPackage(dir)) ?? packageJson(basename(dir), displayName);
  await writePackage(dir, { ...pkg, displayName: displayName.trim() || basename(dir) });

  const project = await describe(dir);
  if (!project) throw new Error("Not a project folder.");
  return project;
}

/**
 * Copies the folder next to itself as `<name>-copy` (numbered when taken); a
 * draft's copy is a draft too, named after its own id.
 */
export async function duplicateProject(dir: string): Promise<ProjectInfo> {
  const source = await describe(dir);
  if (!source) throw new Error("Not a project folder.");

  const id = nanoid();
  const root = dirname(dir);
  const target = source.draft ? join(root, id) : join(root, await freeFolder(root, `${source.name}-copy`));

  await cp(dir, target, { recursive: true, errorOnExist: true, force: false });
  // The record came along with everything else, id included, and two folders
  // answering to one id is the thing the id exists to prevent.
  const pkg = await readPackage(target);
  await writePackage(target, {
    ...(pkg ?? packageJson(basename(target), source.displayName)),
    projectId: id,
    displayName: `${source.displayName} (Copy)`,
  });
  const project = await describe(target);
  if (!project) throw new Error("Failed to duplicate the project.");
  return project;
}

/**
 * Saves the draft in `dir` as `target`: moves its folder there and names the
 * project after it — the name the user typed in the save picker, which is
 * the draft's own unless they changed it. Writes still on their way into the
 * draft land first; whoever has it open lets go of the folder before asking
 * (see `ProjectProvider` in the web app), and opens it again where it went.
 */
export async function saveProject(dir: string, target: string): Promise<ProjectInfo> {
  if (!isDraft(dir)) throw new Error("This project is saved already.");
  await moveFolder(dir, target);
  return renameProject(target, basename(target));
}

/**
 * Moves the saved project in `dir` to `target`, as saving moves a draft —
 * but it keeps its name, which is the user's already. A draft is saved
 * rather than moved.
 */
export async function moveProject(dir: string, target: string): Promise<ProjectInfo> {
  if (isDraft(dir)) throw new Error("Save the draft instead of moving it.");
  await moveFolder(dir, target);
  const project = await describe(target);
  if (!project) throw new Error("Failed to move the project.");
  return project;
}

/** Moves the project folder `dir` to `target`, once whatever is on its way into it has landed. */
async function moveFolder(dir: string, target: string): Promise<void> {
  if (!isAbsolute(target)) throw new Error(`The project folder must be an absolute path (got "${target}").`);
  const problem = await saveProblem(dir, target);
  if (problem) throw new Error(problem);

  await settleWrites(dir);
  unwatchProject(dir);
  await mkdir(dirname(target), { recursive: true });
  try {
    await rename(dir, target);
  } catch (error) {
    // Another volume: there is no moving a folder there, only copying it.
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await cp(dir, target, { recursive: true, errorOnExist: true, force: false });
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Moves the folder to the trash; resolves with the id it had ("" for none), for what is kept outside it.
 * A folder that is already gone counts as deleted, so the project can still come off the list.
 */
export async function deleteProject(dir: string): Promise<string> {
  const id = recordedId(await readPackage(dir));
  unwatchProject(dir);
  if (await exists(dir)) {
    await shell.trashItem(dir);
  }
  return id;
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

const babelOptions = (file: string, filename: string, projectPlugins: PluginItem[]): TransformOptions => ({
  filename,
  babelrc: false,
  configFile: false,
  plugins: [[sourcePlugin, { file }], canonicalizeTagsPlugin, [inspectPlugin, { file }], ...projectPlugins],
  presets: [
    [preset("babel-preset-solid"), { generate: "universal", moduleName: RUNTIME_MODULE }],
    [preset("@babel/preset-typescript"), { onlyRemoveTypeImports: true }],
  ],
});

/**
 * Plugins contributed by the project's own babel config (`babel.config.js` or `.babelrc` at the root).
 */
async function projectBabelPlugins(root: string, entry: string): Promise<PluginItem[]> {
  const { loadPartialConfigAsync } = load<Babel>("@babel/core");
  const partial = await loadPartialConfigAsync({ root, filename: join(root, entry), babelrc: true });
  if (!partial?.hasFilesystemConfig()) return [];
  if (partial.options.presets?.length) {
    console.warn(`[projects] babel config in ${root}: presets are not supported here and were ignored`);
  }
  return partial.options.plugins ?? [];
}

/** Runs project sources (not node_modules) through Solid's universal JSX transform. */
function solidLoader(root: string, projectPlugins: PluginItem[]): Plugin {
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
        const result = await transformAsync(source, babelOptions(name.split(sep).join("/"), args.path, projectPlugins));
        return { contents: result?.code ?? "", loader: "js" };
      });
    },
  };
}

/** The `./edit` context for a project folder, wired to what the watcher knows. */
const sourceContext = (dir: string): SourceContext => ({
  dir,
  onWrite: (file, text) => noteContent(join(dir, file), text),
});

export async function compileProject(dir: string): Promise<CompileResult> {
  const entry = await findEntry(dir);
  if (!entry) return { ok: false, error: noEntryError() };

  // Fills in the package.json record for folders that predate it; the rest
  // of the scaffold is the dashboard's (see `initProject`).
  await ensureRecord(dir);

  // Projects from before generation was removed declare assets the JSX can
  // no longer load; they are pointed at what those declarations produced.
  // Writes nothing to a project with nothing left to migrate.
  await migrateGenerations(sourceContext(dir), await readManifest(dir).catch(() => null));

  // Names every element before it is numbered, so the ids this compile hands
  // the canvas are durable ones. A fully keyed project is not written to.
  await stampProject(sourceContext(dir));

  // esbuild resolves symlinks, so the loader has to match on real paths.
  const root = await realpath(dir);

  // A config that fails to evaluate (or names a plugin that isn't installed)
  // is the project's error, reported like any other compile failure.
  let projectPlugins: PluginItem[];
  try {
    projectPlugins = await projectBabelPlugins(root, entry);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Failed to load the project's babel config: ${message}` };
  }

  try {
    const { build } = load<Esbuild>("esbuild");
    const result = await build({
      ...BUILD_OPTIONS,
      entryPoints: [join(root, entry)],
      plugins: [solidLoader(root, projectPlugins)],
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
 * the watcher is told what the file will hold so that it keeps quiet about it
 * (see `noteContent`).
 */
export async function writeProject(dir: string, edits: SourceEdit[]): Promise<WriteResult> {
  const finish = startWrite(dir);
  try {
    return await applyEdits(sourceContext(dir), edits);
  } catch (error) {
    return { skipped: edits.map(editLabel), error: error instanceof Error ? error.message : String(error) };
  } finally {
    finish();
  }
}

/**
 * Writes into a project that have not finished yet, by folder. Saving a draft
 * moves its folder, and waits these out first (see `settleWrites`): one that
 * lost the race would fail, or put a file back in the folder that just left.
 * A write starts before its first await, so one asked for before the save is
 * always among them.
 */
const writes = new Map<string, Set<Promise<void>>>();

/** Marks a write into `dir` as running; call what it returns when the write is done. */
function startWrite(dir: string): () => void {
  let release!: () => void;
  const done = new Promise<void>((resolve) => (release = resolve));
  const running = writes.get(dir) ?? new Set<Promise<void>>();
  writes.set(dir, running);
  running.add(done);

  return () => {
    release();
    running.delete(done);
    if (!running.size && writes.get(dir) === running) {
      writes.delete(dir);
    }
  };
}

/** Settles once every write into `dir` asked for so far has, however it went. */
async function settleWrites(dir: string): Promise<void> {
  await Promise.allSettled([...(writes.get(dir) ?? []), configWrites.get(dir)]);
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
 * mid-write leaves the old manifest and no reader ever sees half of one, and
 * claimed first so the watcher does not hand it back as a change.
 */
export async function writeManifest(dir: string, manifest: unknown): Promise<void> {
  const finish = startWrite(dir);
  try {
    const path = join(dir, MANIFEST_FILE);
    const text = `# Diffusion Studio asset library. Edited by the app; hand edits are read on the next load.
${stringifyYaml(manifest, { lineWidth: 0 })}`;
    noteContent(path, text);
    await writeFileAtomic(path, text);
  } finally {
    finish();
  }
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

/** Settles when the config write last asked for is done, by project. */
const configWrites = new Map<string, Promise<void>>();

/**
 * Replaces the project's config in its package.json (removes the field for
 * null), leaving the rest of the record alone. The watcher is told to keep
 * quiet about it, like the manifest: the app already shows these values.
 *
 * One at a time, in the order asked: each reads the record the last one left,
 * and the file ends up holding the config the app was given last rather than
 * whichever write happened to finish last.
 */
export async function writeConfig(dir: string, config: unknown): Promise<void> {
  const previous = configWrites.get(dir);
  let release!: () => void;
  const done = new Promise<void>((resolve) => (release = resolve));
  configWrites.set(dir, done);

  try {
    await previous;
    const pkg = (await readPackage(dir)) ?? packageJson(basename(dir), basename(dir));
    const next: PackageJson = { ...pkg };
    if (config === null || config === undefined) delete next[CONFIG_FIELD];
    else next[CONFIG_FIELD] = config;
    await writePackage(dir, next);
  } finally {
    release();
    if (configWrites.get(dir) === done) {
      configWrites.delete(dir);
    }
  }
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

  noteContent(target, null);
  await rm(target, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Watch

const watchers = new Map<string, FSWatcher>();

/**
 * What the app believes is on disk, by absolute path: a digest of the content
 * of every file whose write has been answered for (see `claimed`), and of
 * every change it has already been told about. The watcher stays on — anything else may be editing these files, and
 * should still reach the canvas — but the app's own writes must not come back
 * as a change, or every key stamp and every dragged rect would cost a
 * recompile and a remount of the scene the user is looking at.
 *
 * Identity rather than timing, which is what makes this exact. A change is the
 * app's own when the bytes on disk are the bytes it meant to put there, however
 * long the event takes to arrive: an outside edit is never swallowed for
 * landing too soon after one of ours, and one of ours never gets through for
 * landing too late. A write that changes nothing — a formatter saving back what
 * it was given, a checkout of the blob already there — costs nothing either.
 */
const known = new Map<string, string>();

/**
 * Writes claimed that no event has answered for yet, oldest first, by absolute
 * path. More than one at a time: a slider writes the config on every move, so
 * the next write is claimed before the event for the last one is answered,
 * and that event must still be recognized as ours. One that matches settles
 * every claim made before it, which can no longer land after it.
 */
const claimed = new Map<string, string[]>();

/** Claims kept per path; past this the oldest is taken to have been answered. */
const CLAIMS_MAX = 32;

function claim(path: string, digest: string): void {
  const claims = claimed.get(path) ?? [];
  claims.push(digest);
  if (claims.length > CLAIMS_MAX) claims.shift();
  claimed.set(path, claims);
}

/** Whether `current` is what a claimed write put at `path`; settles it if so. */
function settleClaim(path: string, current: string): boolean {
  const claims = claimed.get(path);
  const index = claims?.indexOf(current) ?? -1;
  if (index < 0) return false;
  claims!.splice(0, index + 1);
  if (!claims!.length) claimed.delete(path);
  known.set(path, current);
  return true;
}

/** Digests for what has no content: a file that is not there, and a folder. */
const ABSENT = "";
const FOLDER = "folder";

/**
 * Above this a file is fingerprinted by size and mtime rather than by content:
 * the library holds whole videos, and re-reading one to answer an event would
 * cost more than the reload it saves. A rename carries both across untouched,
 * so a fingerprint taken from a temp file still answers for the file it
 * becomes (see `noteRenamed`).
 */
const DIGEST_MAX = 8 * 1024 * 1024;

const digest = (content: Buffer | string): string => createHash("sha1").update(content).digest("hex");

/** What `path` holds now: a digest of its content, or `ABSENT` / `FOLDER`. */
async function digestOf(path: string): Promise<string> {
  try {
    const info = await stat(path);
    if (info.isDirectory()) return FOLDER;
    if (info.size > DIGEST_MAX) return `${info.size}:${info.mtimeMs}`;
    return digest(await readFile(path));
  } catch {
    return ABSENT;
  }
}

/**
 * Claims the content a write is about to put at `path` — or, for null, that it
 * is about to take what is there away. Before the write rather than after: the
 * event can arrive the instant the bytes land, and it is answered by comparing
 * them against this. A write that fails halfway leaves the claim wrong, which
 * the next event corrects by reporting a change nobody made — the safe way
 * round, and self-correcting either way.
 */
export function noteContent(path: string, text: string | null): void {
  if (text === null) claim(path, ABSENT);
  else if (Buffer.byteLength(text) > DIGEST_MAX) known.delete(path);
  else claim(path, digest(text));
}

/**
 * Claims the content of the temp file `temp` as what will be found at `as`.
 *
 * The one write whose content the app never holds in one piece is a streamed
 * one — an asset encoded straight to disk. It lands in a temp file, which the
 * watcher ignores, and is renamed into place once it is whole; claiming it
 * from the temp just before that rename is what leaves no window at all. A
 * rename changes neither the bytes nor the mtime, so what is claimed here is
 * exactly what an event will find at `as`.
 */
export async function noteRenamed(temp: string, as: string): Promise<void> {
  claim(as, await digestOf(temp));
}

/** The files a change to which counts as code being written, for analytics. */
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

export function watchProject(window: BrowserWindow | null, dir: string): void {
  if (watchers.has(dir)) return;

  // Events are answered one at a time: answering one means reading the file
  // back, and two reads in flight could settle out of order, leaving `known`
  // holding the older of two contents — and with it a change that would then
  // never be reported.
  let queue: Promise<void> = Promise.resolve();

  const watcher = watch(dir, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    // macOS's recursive FSEvents watch fires an extra notification for the
    // watched folder itself alongside the real one for whatever changed
    // inside it — and again once more, asynchronously, after the folder is
    // removed and the watcher closed. Neither names an actual project file.
    if (filename === basename(dir)) return;
    // Project-relative and `/`-separated; installs churn node_modules constantly.
    const path = filename.split(sep).join("/");
    if (path.startsWith("node_modules/") || path === "node_modules") return;
    // The app's folder: a docs refresh writes the whole tree in one burst.
    if (path.startsWith(`${APP_DIR}/`) || path === APP_DIR) return;
    // Half a file by definition, and renamed away the moment it is whole.
    if (isTempPath(path)) return;

    const file = join(dir, filename);
    queue = queue
      .then(async () => {
        const current = await digestOf(file);
        if (settleClaim(file, current) || known.get(file) === current) return;
        known.set(file, current);
        if (SOURCE_FILE.test(path) && current !== ABSENT) countCodeChange(path);

        mainBridge.emit(window, MAIN_CHANNELS.PROJECTS_CHANGED, { dir, path });
      })
      .catch(() => { });
  });
  watcher.on("error", () => unwatchProject(dir));
  watchers.set(dir, watcher);
}

export function unwatchProject(dir: string): void {
  watchers.get(dir)?.close();
  watchers.delete(dir);
  // What the folder holds while nobody is watching is not the app's to
  // remember: the next watch starts from a fresh load of the project anyway.
  const prefix = dir.endsWith(sep) ? dir : dir + sep;
  for (const path of known.keys()) if (path.startsWith(prefix)) known.delete(path);
  for (const path of claimed.keys()) if (path.startsWith(prefix)) claimed.delete(path);
}

export function unwatchAll(): void {
  for (const dir of [...watchers.keys()]) unwatchProject(dir);
}
