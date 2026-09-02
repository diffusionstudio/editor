/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Renderer half of on-disk projects. Projects live as folders under a root
// (persisted) — a default one until the user picks another; each project's
// package.json is its record (`projectId`, `displayName`, `main`). The
// desktop main process scans, scaffolds, renames, copies, trashes, compiles,
// and watches them. Desktop only for now: without the bridge every call
// rejects and the root is null.
//
// A project is addressed by its folder — an absolute path, which is what main
// takes — and identified by its id, which is what the app's URLs carry and
// what survives the folder being renamed. `resolveProject` is the one bridge
// between the two; callers get the folder from the `ProjectInfo` it answers
// with (and the open project's from `@/context/project`).

import { createSignal } from 'solid-js';

import { MAIN_CHANNELS } from '@desktop/main-channels';
import { mainBridge } from '@/lib/ipc';
import { lastUsedProjectRoot, listProjectRoots, rememberProjectRoot } from '@/lib/db';

import type { CompileResponse, ProjectInfo, SourceEdit, WriteResult } from '@desktop/main-channels';
import { companionSnapshot, initializeBrowserCompanion, onCompanionMessage, reportCompanionApplied } from '@/lib/browser-companion';
import { isBrowserCompanionRenderer } from '@/lib/companion-authority';
import { isBrowserCompanionHostRenderer } from '@/lib/local-only';
import { readCompanionProjectConfig } from './companion-fs';

export type { CompileResult, ProjectInfo, SourceEdit, WriteResult } from '@desktop/main-channels';

// The roots live in the app's IndexedDB (see @/lib/db) as a list
// keyed by path. The app works against one of them — the one used last — but
// the store is already the list several roots will need, so growing into them
// is UI rather than a migration.
//
// Reading a database is asynchronous, so the root starts null and arrives a
// tick later. Every call here waits for it, leaving only the UI to tell "no
// root yet" from "no root picked" — which is what `rootsReady` is for.

const [projectsRoot, setProjectsRoot] = createSignal<string | null>(null);
const [rootsReady, setRootsReady] = createSignal(false);
const companionCompileIdentities = new WeakMap<object, { sessionId: string; revision: number; bundleHash: string }>();

async function hashCompileResult(result: CompileResponse): Promise<string> {
	const source = result.ok ? result.code : `compile-error:\n${result.error}`;
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The projects root folder: null until one is picked, and until `rootsReady`. */
export { projectsRoot };

/** Whether the roots have been read back from the database yet. */
export { rootsReady };

const ready = new Promise<void>((resolve) => {
	lastUsedProjectRoot()
		.then((root) => setProjectsRoot(root?.path ?? null))
		.catch((error) => console.error('[projects] could not read the projects roots', error))
		.finally(() => {
			setRootsReady(true);
			resolve();
		});
});

export const isDesktop = (): boolean => !!window.desktop;

/** The projects root, waited for: null off the desktop and until one is picked. */
export async function getProjectsRoot(): Promise<string | null> {
	if (isBrowserCompanionRenderer()) return null;
	await ready;
	return projectsRoot();
}

/** Opens the native folder picker and remembers the chosen root. */
export async function pickProjectsRoot(): Promise<string | null> {
	const root = await mainBridge.call(MAIN_CHANNELS.PROJECTS_PICK_ROOT, undefined);
	if (!root) return null;

	await rememberProjectRoot(root);
	setProjectsRoot(root);
	return root;
}

/**
 * The root to work against, waited for and — when there is none to wait for —
 * defaulted to. Null off the desktop, where there is no folder at all, and
 * when the user is asked where to put projects and declines to say.
 */
export async function ensureProjectsRoot(): Promise<string | null> {
	if (!isDesktop()) return null;
	await ready;

	const current = projectsRoot();
	if (current) return current;

	// Nothing picked yet: the default folder, so a first project costs a click
	// rather than a trip through the folder picker. The picker is still there
	// for anyone who wants to say — and for when the default will not do.
	const root = await mainBridge.call(MAIN_CHANNELS.PROJECTS_DEFAULT_ROOT, undefined);
	if (!root) return pickProjectsRoot();

	await rememberProjectRoot(root);
	setProjectsRoot(root);
	return root;
}

export async function listProjects(): Promise<ProjectInfo[]> {
	await ready;
	const root = projectsRoot();
	if (!root || !isDesktop()) return [];
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_LIST, { root });
}

/** Creates a project folder under the root, named after `displayName`. */
export async function createProject(displayName: string): Promise<ProjectInfo> {
	await ready;
	const root = projectsRoot();
	if (!root) throw new Error('No projects folder selected.');
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_CREATE, { root, displayName });
}

/**
 * The project `ref` names: its id, or — for links made before ids existed,
 * and folders opened by name — its folder name. The active root is searched
 * first (and hands out ids, so the app can put one in the URL); on a miss,
 * the single-project roots answer for projects living anywhere else on disk,
 * matched by id or folder name, most recently used first.
 */
export async function resolveProject(ref: string): Promise<ProjectInfo | null> {
	if (isBrowserCompanionRenderer()) {
		const current = await initializeBrowserCompanion();
		if (!current || (ref !== current.project.id && ref !== 'active')) return null;
		return companionProjectInfo(current);
	}
  await ready;
  if (!ref || !isDesktop()) return null;

	const root = projectsRoot();
	if (root) {
		const found = await mainBridge.call(MAIN_CHANNELS.PROJECTS_RESOLVE, { root, ref });
		if (found) return found;
	}

	for (const single of await listProjectRoots('single')) {
		const project = await getProject(single.path);
		if (project && (project.id === ref || project.name === ref)) return project;
	}
	return null;
}

/**
 * Opens the folder `dir` as a project, making it one first when it is not:
 * the folder is created if missing and, when nothing in it can be an entry,
 * given an `index.tsx` holding an empty stage — and nothing else. Remembered
 * as a single-project root unless it lives under the active root (where the
 * ordinary resolution already finds it), so it stays reachable by name or id
 * across relaunches. How `dapi open <path>` lands anywhere on disk.
 */
export async function openProjectFolder(dir: string): Promise<ProjectInfo> {
	await ready;
	if (!isDesktop()) throw new Error('Opening a project folder requires the desktop app.');

	const project = await mainBridge.call(MAIN_CHANNELS.PROJECTS_INIT, { dir });

	const root = projectsRoot();
	const underRoot = root !== null && project.dir.startsWith(root.replace(/\/+$/, '') + '/');
	if (!underRoot) await rememberProjectRoot(project.dir, 'single');

	return project;
}

/** The project in the folder `dir`, or null when there is none. */
export async function getProject(dir: string): Promise<ProjectInfo | null> {
	if (isBrowserCompanionRenderer()) {
		const current = companionSnapshot();
		return current && dir === `companion:${current.project.id}` ? companionProjectInfo(current) : null;
	}
	if (!dir || !isDesktop()) return null;
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_GET, { dir });
}

/**
 * Renames the project: `displayName` in the record, and the folder with it.
 * The folder moves, so the answer says where the project now lives — hold on
 * to it. Its id has not changed, and neither has its URL.
 */
export async function renameProject(dir: string, displayName: string): Promise<ProjectInfo> {
	if (!dir) throw new Error('No project folder.');
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_RENAME, { dir, displayName });
}

/** Copies the project in `dir` next to itself and returns the copy (a new id). */
export async function duplicateProject(dir: string): Promise<ProjectInfo> {
	if (!dir) throw new Error('No project folder.');
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_DUPLICATE, { dir });
}

/** Moves the project in `dir` to the trash. */
export async function deleteProject(dir: string): Promise<void> {
	if (!dir) throw new Error('No project folder.');
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_DELETE, { dir });
}

/**
 * What to put in a project's URL: its id, or its folder name while it has
 * none (a folder that predates ids gets one the next time it is opened).
 */
export const projectKey = (project: ProjectInfo): string => project.id || project.name;

export function compileProject(
	dir: string,
	options: { companionSurfaceMount?: boolean } = {},
): Promise<CompileResponse> {
	if (isBrowserCompanionRenderer()) {
		const current = companionSnapshot();
		if (!current || dir !== `companion:${current.project.id}`) return Promise.resolve({ ok: false, error: 'Companion project unavailable' });
		companionCompileIdentities.set(current.bundle, {
			sessionId: current.sessionId,
			revision: current.revision,
			bundleHash: current.bundleHash,
		});
		return Promise.resolve(current.bundle);
	}
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_COMPILE, {
		dir,
		...(options.companionSurfaceMount ? { companionSurfaceMount: true } : {}),
	});
}

/** A mount acknowledgement is emitted only after reconciler mount succeeds or fails. */
export async function reportProjectBundleApplied(
	dir: string,
	result: CompileResponse,
	ok: boolean,
	error?: string,
): Promise<void> {
	if (isBrowserCompanionRenderer()) {
		const identity = companionCompileIdentities.get(result);
		if (!identity) throw new Error('Companion bundle identity is unavailable');
		reportCompanionApplied({ ...identity, ok, ...(error ? { error: error.slice(0, 4000) } : {}) });
		return;
	}
	if (!isBrowserCompanionHostRenderer()) return;
	// A cold hidden host may restore its last DAPI project before a companion
	// prepare has armed a root/session. It still mounts normally, but there is
	// no companion revision to acknowledge. Once prepare is armed, main adds
	// the exact identity; absence then fails readiness by bounded timeout.
	if (!result.companionMount) return;
	await mainBridge.call(MAIN_CHANNELS.PROJECTS_BUNDLE_APPLIED, {
		dir,
		...result.companionMount,
		bundleHash: await hashCompileResult(result),
		ok,
		...(error ? { error: error.slice(0, 4000) } : {}),
	});
}

/**
 * Writes changed props back into the project's JSX. No compile follows: the
 * canvas is already showing these values, and main keeps the write from
 * reaching the watcher (see `markSelfWrite` in the desktop's projects.ts).
 */
export function writeProject(dir: string, edits: SourceEdit[]): Promise<WriteResult> {
	if (isBrowserCompanionRenderer()) return Promise.reject(new Error('Browser companion is read-only'));
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_WRITE, { dir, edits });
}

/** The project's config (the `diffusion` field of its package.json), unparsed; null when absent. */
export function readProjectConfig(dir: string): Promise<unknown> {
	if (isBrowserCompanionRenderer()) return readCompanionProjectConfig();
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_CONFIG_READ, { dir });
}

/** Replaces the project's config (null removes the field). Kept from the watcher like `writeProject`. */
export function writeProjectConfig(dir: string, config: unknown): Promise<void> {
	if (isBrowserCompanionRenderer()) return Promise.reject(new Error('Browser companion is read-only'));
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_CONFIG_WRITE, { dir, config });
}

/**
 * Watches a project folder and calls `onChange` (debounced) when a file
 * inside it changes. Returns the unwatch function.
 */
export function watchProject(dir: string, onChange: (path: string) => void, debounceMs = 80): () => void {
	if (isBrowserCompanionRenderer()) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const changed = (path: string) => {
			clearTimeout(timer);
			timer = setTimeout(() => onChange(path), debounceMs);
		};
		const stopBundle = onCompanionMessage((message) => {
			if (message.type === 'bundle') changed('index.tsx');
		});
		return () => { clearTimeout(timer); stopBundle(); };
	}
	if (!isDesktop()) return () => {};

	let pending: ReturnType<typeof setTimeout> | undefined;
	let last = '';
	const stop = mainBridge.handle(MAIN_CHANNELS.PROJECTS_CHANGED, (event) => {
		if (event.dir !== dir) return;
		last = event.path;
		clearTimeout(pending);
		pending = setTimeout(() => onChange(last), debounceMs);
	});
	void mainBridge.call(MAIN_CHANNELS.PROJECTS_WATCH, { dir });

	return () => {
		clearTimeout(pending);
		stop();
		void mainBridge.call(MAIN_CHANNELS.PROJECTS_UNWATCH, { dir }).catch(() => {});
	};
}

function companionProjectInfo(current: NonNullable<ReturnType<typeof companionSnapshot>>): ProjectInfo {
	return {
		id: current.project.id,
		name: current.project.name,
		displayName: current.project.displayName,
		dir: `companion:${current.project.id}`,
		entry: 'index.tsx',
		modifiedAt: new Date(0).toISOString(),
		createdAt: new Date(0).toISOString(),
	};
}
