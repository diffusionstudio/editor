/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The asset library of a project: the manifest, loaded with handles attached,
// plus everything that changes it — imports, renames, folders, bytes the app
// produced — and the one place a `src` is turned into an asset. Files the user
// imports stay where they are (the manifest links to them by absolute path);
// only bytes the app itself produces are written into the project's
// `assets/` directory, and anything found there that the manifest does not
// know is taken into the library. What is derived from assets and worth
// keeping (thumbnails, waveforms) is the `cache`'s, under `cache/`.
//
// Knows nothing of the host: files come and go through a `ProjectFS`, and
// what it cannot do itself (follow a rename into whatever names assets by
// path, rebind whatever is bound to a relinked asset's old id) it asks of
// `LibraryOptions`. Its state is solid signals (`assets()`, `folders()`), so
// readers inside a tracking scope follow it.

import { createSignal, type Accessor } from 'solid-js';

import { AssetCache } from './cache';
import { hashBlob, hashSequence } from './hash';
import {
	ASSETS_DIR, isAbsoluteSource, isProjectSource, isUrlSource, normalizeManifest, toRecord,
} from './manifest';
import { detectMimeType, DEFAULT_SEQUENCE_FPS, isSequenceListing, probeMedia, sortFrames } from './probe';
import { assetFolder, assetName, basename, dirname, joinPath, normalizePath } from './types';

import type { FsEntry, ProjectFS } from './fs';
import type { AssetRecord, Manifest } from './manifest';
import type { Asset, AssetDirectoryHandle, AssetFileHandle, SequenceAsset } from './types';

/** How long changes pile up before the manifest is written. */
const SAVE_DEBOUNCE = 200;

export interface LibraryOptions {
	/**
	 * Called when an asset's library path changes (renamed or moved), so the
	 * host can follow in whatever names assets by path — the JSX `src` props.
	 */
	onRename?: (asset: Asset, from: string) => void;
	/**
	 * Called when an asset is pointed at other bytes and so has a new id, so
	 * the host can rebind whatever held the old one (`from`).
	 */
	onRelink?: (asset: Asset, from: string) => void;
}

export interface ImportResult {
	/** What was taken in, in the order it finished. */
	assets: Asset[];
	/** Sources the library refused, with why. */
	failed: { source: string; error: Error }[];
}

export interface ImportOptions {
	/** Library folder to place the asset in; root by default. */
	folder?: string;
	/** Library name; the source's file name by default. */
	name?: string;
}

export class AssetLibrary {
	public readonly fs: ProjectFS;
	/** Thumbnails, rough waveforms: what is derived from assets and kept in `cache/`. */
	public readonly cache: AssetCache;
	/** Library assets, newest first; transient ones excluded. Reactive. */
	public readonly assets: Accessor<Asset[]>;
	/** Every folder: declared ones, those implied by asset paths, and their ancestors. Reactive. */
	public readonly folders: Accessor<ReadonlySet<string>>;

	private readonly setAssets: (assets: Asset[]) => void;
	private readonly setFolders: (folders: ReadonlySet<string>) => void;
	/** Folders declared in the manifest (the empty ones need declaring). */
	private declared = new Set<string>();
	/** Every asset by id: the library's, and transient ones resolved from outside it. */
	private readonly map = new Map<string, Asset>();
	private readonly onRename: LibraryOptions['onRename'];
	private readonly onRelink: LibraryOptions['onRelink'];
	private inflight = new Map<string, Promise<Asset>>();
	private saveTimer: ReturnType<typeof setTimeout> | undefined;
	private saving: Promise<void> = Promise.resolve();
	private dirty = false;
	private disposed = false;

	public constructor(fs: ProjectFS, options: LibraryOptions = {}) {
		this.fs = fs;
		this.cache = new AssetCache(fs);
		this.onRename = options.onRename;
		this.onRelink = options.onRelink;
		[this.assets, this.setAssets] = createSignal<Asset[]>([]);
		[this.folders, this.setFolders] = createSignal<ReadonlySet<string>>(new Set());
	}

	// -----------------------------------------------------------------------
	// Reading

	/** Library assets, newest first; transient ones excluded. Same as `assets()`. */
	public list(): Asset[] {
		return this.assets();
	}

	/** The library's assets as of now, straight from the map. */
	private listNow(): Asset[] {
		const assets: Asset[] = [];
		for (const entry of this.map.values()) {
			if (!entry.transient) assets.push(entry);
		}
		return assets;
	}

	/** The asset with `id`, or at library path `path`; undefined otherwise. */
	public get(pathOrId: string): Asset | undefined {
		const byId = this.map.get(pathOrId);
		if (byId) return byId;
		const path = normalizePath(pathOrId);
		for (const asset of this.listNow()) {
			if (asset.path === path) return asset;
		}
		return undefined;
	}

	/** The asset whose bytes are `source`, if the library links to it. */
	public bySource(source: string): Asset | undefined {
		for (const asset of this.listNow()) {
			if (asset.source === source) return asset;
		}
		return undefined;
	}

	/** Direct children of a folder ('' for the root): its subfolders and assets. Reactive. */
	public childrenOf(folder: string): { folders: string[]; assets: Asset[] } {
		const prefix = folder ? `${folder}/` : '';
		const folders = new Set<string>();
		for (const path of this.folders()) {
			if (path.startsWith(prefix) && path !== folder && !path.slice(prefix.length).includes('/')) {
				folders.add(path);
			}
		}
		const assets = this.assets().filter((asset) => assetFolder(asset) === folder);
		return { folders: [...folders].sort(), assets };
	}

	/** Every folder as of now: declared, implied by asset paths, and all their ancestors. */
	private foldersNow(): Set<string> {
		const folders = new Set<string>();
		const declare = (path: string): void => {
			for (let folder = path; folder && !folders.has(folder); folder = dirname(folder)) folders.add(folder);
		};
		for (const folder of this.declared) declare(folder);
		for (const asset of this.listNow()) declare(assetFolder(asset));
		return folders;
	}

	/** Publishes the map's state to the signals. */
	private publish(): void {
		this.setAssets(this.listNow());
		this.setFolders(this.foldersNow());
	}

	// -----------------------------------------------------------------------
	// Loading

	/**
	 * Reads the manifest in, then takes in whatever the project's
	 * `assets/` directory holds that the manifest does not know. Assets whose
	 * source changed since they were recorded (by size or mtime) are probed
	 * again. Safe to call again: it reconciles rather than replaces.
	 */
	public async load(): Promise<void> {
		await this.flush();
		const manifest = normalizeManifest(await this.fs.readManifest());
		this.declared = new Set(manifest.folders);

		const next = new Map<string, Asset>();
		await Promise.all(manifest.assets.map(async (record) => {
			const asset = await this.revive(record).catch((error: unknown) => {
				console.warn(`[assets] could not load ${record.path}:`, error);
				return this.attach(record);
			});
			next.set(asset.id, asset);
		}));

		// Keep transient assets and the same-id instances entities already hold.
		for (const [id, entry] of this.map) {
			if (entry.transient && !next.has(id)) next.set(id, entry);
		}
		this.map.clear();
		for (const [id, asset] of next) {
			this.map.set(id, asset);
		}

		this.publish();
		await this.scanAssetsDir();
		this.publish();
		this.cache.prune(this.map.keys());
	}

	/** Attaches handles to a record; re-examines it when its source changed. */
	private async revive(record: AssetRecord): Promise<Asset> {
		if (isUrlSource(record.source)) return this.attach(record);

		if (record.type === 'SEQUENCE') {
			const frames = sortFrames(await this.fs.list(record.source)).filter((entry) => entry.kind === 'file');
			const id = await hashSequence(frames);
			if (id === record.id) return this.attach(record);
			return this.describeSequence(record.source, frames, { path: record.path, createdAt: record.createdAt });
		}

		const stat = await this.fs.stat(record.source);
		if (!stat || (record.stat && stat.size === record.stat.size && stat.mtime === record.stat.mtime)) {
			return this.attach(record);
		}
		return this.describeFile(record.source, { path: record.path, createdAt: record.createdAt });
	}

	/**
	 * Registers files under `assets/` that the manifest does not link to.
	 *
	 * A linked folder is walked like any other — linking media in is all it
	 * takes to have it — but a link can also point back at somewhere the walk
	 * has already been, and following that would list the same files over and
	 * over under an ever longer path. So every linked folder is resolved and
	 * entered once: a second link to the same place is passed over, and one
	 * that holds `assets/` itself is never entered at all.
	 */
	private async scanAssetsDir(): Promise<void> {
		const known = new Set(this.listNow().map((asset) => asset.source));
		const entered = new Set<string>();
		// The library's own place, resolved on the first link that asks for it.
		let root: string | null | undefined;

		/** Whether a linked folder is one the walk has not been inside already. */
		const enter = async (dir: string): Promise<boolean> => {
			const real = await this.fs.realPath?.(dir).catch(() => null);
			// A host that cannot resolve links has no cycles to report; follow it.
			if (!real) return true;
			if (root === undefined) root = (await this.fs.realPath?.(ASSETS_DIR).catch(() => null)) ?? null;
			const separator = real.includes('\\') ? '\\' : '/';
			if (root && (root === real || root.startsWith(`${real}${separator}`))) return false;
			if (entered.has(real)) return false;
			entered.add(real);
			return true;
		};

		const walk = async (dir: string): Promise<void> => {
			const entries = await this.fs.list(dir);
			if (dir !== ASSETS_DIR && isSequenceListing(entries.map((entry) => entry.name))) {
				if (!known.has(dir)) await this.link(dir, { folder: dirname(dir.slice(ASSETS_DIR.length + 1)) }).catch(() => { });
				return;
			}
			for (const entry of entries) {
				if (entry.name.startsWith('.')) continue;
				const source = joinPath(dir, entry.name);
				if (entry.kind === 'directory') {
					if (entry.link && !(await enter(source))) continue;
					await walk(source);
				} else if (!known.has(source)) {
					await this.link(source, { folder: dirname(source.slice(ASSETS_DIR.length + 1)) }).catch(() => { });
				}
			}
		};
		await walk(ASSETS_DIR);
	}

	// -----------------------------------------------------------------------
	// Resolving

	/**
	 * The asset a source string names: a library path or id, or an absolute
	 * path or URL (resolved on the fly, kept in memory only).
	 */
	public async resolve(input: string): Promise<Asset> {
		const value = input.trim();
		const known = this.get(value);
		if (known) return known;

		if (isUrlSource(value) || isAbsoluteSource(value)) {
			return this.transient(value);
		}

		// A project-relative path that exists is a file of the project.
		if (value.includes('/') && (await this.fs.stat(value))) {
			return this.transient(value);
		}

		throw new Error(`Could not resolve media src: ${input}`);
	}

	/** Resolves a source outside the library without adding it to the manifest. */
	private transient(source: string): Promise<Asset> {
		const existing = this.transientBySource(source);
		if (existing) return Promise.resolve(existing);

		return this.once(`transient:${source}`, async () => {
			const asset = isUrlSource(source)
				? await this.describeUrl(source, { path: basename(source.split(/[?#]/)[0]!) })
				: await this.describeSource(source, { path: basename(source) });
			asset.transient = true;
			// A transient asset that turns out to be one the library has is that one.
			const owned = this.map.get(asset.id);
			if (owned && !owned.transient) return owned;
			this.map.set(asset.id, asset);
			return asset;
		});
	}

	private transientBySource(source: string): Asset | undefined {
		for (const entry of this.map.values()) {
			if (entry.transient && entry.source === source) return entry;
		}
		return undefined;
	}

	/** The File backing an asset. */
	public file(asset: Asset): Promise<File> {
		return asset.handle.getFile();
	}

	// -----------------------------------------------------------------------
	// Importing

	/**
	 * Imports sources into the library, all at once, leaving their bytes where
	 * they are: a file (absolute path, or a path inside the project) is linked,
	 * a frames directory becomes one sequence asset, any other directory
	 * becomes a folder with its files linked inside (recursively), and a URL
	 * is downloaded into `assets/`. The same bytes imported twice are one
	 * asset. Every source is tried; the result says which were refused and why.
	 */
	public async import(sources: readonly string[], options: ImportOptions = {}): Promise<ImportResult> {
		const result: ImportResult = { assets: [], failed: [] };
		await Promise.all(sources.map(async (source) => {
			try {
				result.assets.push(...await this.importOne(source, options));
			} catch (error) {
				result.failed.push({ source, error: error instanceof Error ? error : new Error(String(error)) });
			}
		}));
		return result;
	}

	private async importOne(source: string, options: ImportOptions): Promise<Asset[]> {
		if (isUrlSource(source)) {
			const response = await fetch(source);
			if (!response.ok) throw new Error(`Failed to fetch ${source}: ${response.status}`);
			const blob = await response.blob();
			const name = options.name ?? basename(source.split(/[?#]/)[0]!) ?? 'download';
			return [await this.store(blob, { ...options, name })];
		}

		const entries = await this.fs.list(source);
		if (!entries.length || isSequenceListing(entries.map((entry) => entry.name))) {
			return [await this.link(source, options)];
		}

		// A folder of files: a folder here, with each of them in it.
		const folder = this.createFolder(joinPath(options.folder ?? '', options.name ?? basename(source)));
		const children = entries.filter((entry) => !entry.name.startsWith('.')).map((entry) => joinPath(source, entry.name));
		return (await this.import(children, { folder })).assets;
	}

	/** Links a file at `source` (absolute, or project-relative) into the library. */
	private link(source: string, options: ImportOptions): Promise<Asset> {
		const existing = this.bySource(source);
		if (existing) return Promise.resolve(existing);

		return this.once(`link:${source}`, async () => {
			const name = options.name ?? basename(source);
			const path = this.uniquePath(joinPath(options.folder ?? '', name));
			const asset = await this.describeSource(source, { path });
			return this.add(asset);
		});
	}

	/**
	 * Writes bytes the app produced into `assets/<folder>/<name>` and takes
	 * the file into the library at the same library path.
	 */
	public async store(blob: Blob, options: ImportOptions & { name: string }): Promise<Asset> {
		const path = this.uniquePath(joinPath(options.folder ?? '', options.name));
		const source = joinPath(ASSETS_DIR, path);
		await this.fs.write(source, blob);
		const asset = await this.describeFile(source, { path });
		return this.add(asset);
	}

	/** Puts an asset into the library, deduplicating by content. */
	private add(asset: Asset): Asset {
		const existing = this.map.get(asset.id);
		if (existing) {
			if (!existing.transient) return existing;
			// A transient asset the library now takes in becomes a real one; the
			// instance entities hold stays valid, so mutate rather than replace.
			Object.assign(existing, asset);
			delete existing.transient;
			this.reorder(existing);
			this.changed();
			return existing;
		}
		this.reorder(asset);
		this.changed();
		return asset;
	}

	/** Puts `asset` at the front of the map (newest first). */
	private reorder(asset: Asset): void {
		const rest = Array.from(this.map.values()).filter((other) => other.id !== asset.id);
		this.map.clear();
		this.map.set(asset.id, asset);
		for (const other of rest) this.map.set(other.id, other);
	}

	// -----------------------------------------------------------------------
	// Editing

	/** Replaces fields of an asset (a transcript, a corrected frame rate). Keeps identity. */
	public update<T extends Asset>(asset: T, patch: Partial<Omit<T, 'id' | 'handle' | 'type'>>): T {
		Object.assign(asset, patch);
		this.changed();
		return asset;
	}

	/**
	 * Points an asset at other bytes: same library path (so the JSX is
	 * untouched), new source, new content id. Whatever is bound to the old id
	 * is the host's to move over (`onRelink`).
	 */
	public async relink(asset: Asset, source: string): Promise<Asset> {
		const next = await this.describeSource(source, { path: asset.path, createdAt: asset.createdAt });
		const from = asset.id;
		if (next.id === from) {
			Object.assign(asset, next);
			this.changed();
			return asset;
		}
		this.map.delete(from);
		this.reorder(next);
		this.changed();
		this.cache.remove(from);
		this.onRelink?.(next, from);
		return next;
	}

	/** Renames an asset within its folder; its source file is untouched. */
	public rename(asset: Asset, name: string): void {
		const clean = normalizePath(name).replace(/\//g, '-');
		if (!clean || clean === assetName(asset)) return;
		this.setPath(asset, this.uniquePath(joinPath(assetFolder(asset), clean), asset));
	}

	/** Moves assets into a folder ('' for the root). */
	public move(assets: Asset[], folder: string): void {
		const target = normalizePath(folder);
		if (target) this.declared.add(target);
		for (const asset of assets) {
			if (assetFolder(asset) === target) continue;
			this.setPath(asset, this.uniquePath(joinPath(target, assetName(asset)), asset));
		}
	}

	private setPath(asset: Asset, path: string): void {
		const from = asset.path;
		if (from === path) return;
		asset.path = path;
		this.changed();
		this.onRename?.(asset, from);
	}

	/** Removes assets from the library. Bytes the app wrote into `assets/` go too. */
	public async remove(assets: Asset[]): Promise<void> {
		for (const asset of assets) {
			this.map.delete(asset.id);
			if (isProjectSource(asset.source) && asset.source.startsWith(`${ASSETS_DIR}/`)) {
				await this.fs.remove(asset.source).catch(() => { });
			}
			this.cache.remove(asset);
		}
		this.changed();
	}

	public createFolder(path: string): string {
		const folder = normalizePath(path);
		if (folder) {
			this.declared.add(folder);
			this.changed();
		}
		return folder;
	}

	/** A folder name free under `parent`, from `base` (`base`, `base 2`, …). */
	public uniqueFolderName(parent: string, base: string): string {
		const prefix = parent ? `${parent}/` : '';
		const taken = [...this.foldersNow()]
			.filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
			.map(basename);
		let name = base;
		for (let n = 2; taken.includes(name); n++) name = `${base} ${n}`;
		return name;
	}

	/** Renames a folder in place; everything under it follows. */
	public renameFolder(path: string, name: string): string {
		const clean = normalizePath(name).replace(/\//g, '-');
		if (!clean) return path;
		return this.moveFolderTo(path, joinPath(dirname(path), clean));
	}

	/** Moves a folder into another ('' for the root); refuses to move it into itself. */
	public moveFolder(path: string, into: string): string {
		const target = normalizePath(into);
		if (target === path || target.startsWith(`${path}/`)) return path;
		return this.moveFolderTo(path, joinPath(target, basename(path)));
	}

	private moveFolderTo(from: string, to: string): string {
		if (from === to || !from) return from;
		if (this.foldersNow().has(to)) to = joinPath(dirname(to), this.uniqueFolderName(dirname(to), basename(to)));

		const prefix = `${from}/`;
		for (const folder of [...this.declared]) {
			if (folder === from || folder.startsWith(prefix)) {
				this.declared.delete(folder);
				this.declared.add(to + folder.slice(from.length));
			}
		}
		this.declared.add(to);
		for (const asset of this.listNow()) {
			if (asset.path.startsWith(prefix)) this.setPath(asset, to + asset.path.slice(from.length));
		}
		this.changed();
		return to;
	}

	/** Deletes a folder and everything in it. Returns the removed assets. */
	public async deleteFolder(path: string): Promise<Asset[]> {
		const prefix = `${path}/`;
		for (const folder of [...this.declared]) {
			if (folder === path || folder.startsWith(prefix)) this.declared.delete(folder);
		}
		const doomed = this.listNow().filter((asset) => asset.path.startsWith(prefix));
		await this.remove(doomed);
		return doomed;
	}

	// -----------------------------------------------------------------------
	// Persisting

	private changed(): void {
		if (this.disposed) return;
		this.dirty = true;
		this.publish();
		clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => void this.flush(), SAVE_DEBOUNCE);
	}

	/** The manifest as it would be written now. */
	public manifest(): Manifest {
		return {
			version: 1,
			folders: [...this.declared].sort(),
			assets: this.listNow().map(toRecord),
		};
	}

	/** Writes the manifest if anything changed. Writes are serialized. */
	public flush(): Promise<void> {
		clearTimeout(this.saveTimer);
		if (!this.dirty) return this.saving;
		this.dirty = false;
		this.saving = this.saving
			.then(() => this.fs.writeManifest(this.manifest()))
			.catch((error: unknown) => console.error('[assets] could not write the manifest:', error));
		return this.saving;
	}

	/** Writes what is pending and stops. */
	public dispose(): Promise<void> {
		const done = this.flush();
		this.disposed = true;
		return done;
	}

	// -----------------------------------------------------------------------
	// Describing

	/** A library path not taken by any other asset: `name`, `name 2`, … */
	private uniquePath(path: string, except?: Asset): string {
		const taken = new Set(this.listNow().filter((asset) => asset !== except).map((asset) => asset.path));
		if (!taken.has(path)) return path;
		const folder = dirname(path);
		const name = basename(path);
		const dot = name.lastIndexOf('.');
		const stem = dot > 0 ? name.slice(0, dot) : name;
		const ext = dot > 0 ? name.slice(dot) : '';
		for (let n = 2; ; n++) {
			const candidate = joinPath(folder, `${stem} ${n}${ext}`);
			if (!taken.has(candidate)) return candidate;
		}
	}

	private once(key: string, run: () => Promise<Asset>): Promise<Asset> {
		const running = this.inflight.get(key);
		if (running) return running;
		const promise = run().finally(() => this.inflight.delete(key));
		this.inflight.set(key, promise);
		return promise;
	}

	/** Describes a file or frames directory at `source`. */
	private async describeSource(source: string, meta: DescribeMeta): Promise<Asset> {
		// A path that is not there fails as that, not as an unsupported file
		// once the mime sniff finds nothing to read.
		if (!(await this.fs.stat(source))) throw new Error(`No such file: ${source}`);
		const entries = await this.fs.list(source);
		if (entries.length && isSequenceListing(entries.map((entry) => entry.name))) {
			return this.describeSequence(source, sortFrames(entries).filter((entry) => entry.kind === 'file'), meta);
		}
		return this.describeFile(source, meta);
	}

	private async describeFile(source: string, meta: DescribeMeta): Promise<Asset> {
		const handle = this.fileHandle(source);
		const file = await handle.getFile();
		const mimeType = await detectMimeType(file);
		if (!mimeType) throw new Error(`Unsupported file: ${basename(source)}`);
		const [id, probe] = await Promise.all([hashBlob(file), probeMedia(file, mimeType)]);

		return {
			id,
			path: meta.path,
			source,
			createdAt: meta.createdAt ?? new Date().toISOString(),
			mimeType,
			stat: { size: file.size, mtime: file.lastModified },
			handle,
			...probe,
		};
	}

	private async describeUrl(url: string, meta: DescribeMeta): Promise<Asset> {
		const mimeType = await detectMimeType(url);
		if (!mimeType) throw new Error(`Unsupported resource: ${url}`);
		const handle = this.urlHandle(url);
		const file = await handle.getFile();
		const [id, probe] = await Promise.all([hashBlob(file), probeMedia(file, mimeType)]);

		return {
			id,
			path: meta.path,
			source: url,
			createdAt: meta.createdAt ?? new Date().toISOString(),
			mimeType,
			handle,
			...probe,
		};
	}

	private async describeSequence(source: string, frames: FsEntry[], meta: DescribeMeta): Promise<SequenceAsset> {
		if (!frames.length) throw new Error(`Empty sequence: ${basename(source)}`);
		const first = frames[0]!;
		const handle = this.fileHandle(joinPath(source, first.name));
		const file = await handle.getFile();
		const mimeType = await detectMimeType(file);
		if (!mimeType?.startsWith('image/')) throw new Error(`Not an image sequence: ${basename(source)}`);
		const probe = await probeMedia(file, mimeType);
		if (probe.type !== 'IMAGE') throw new Error(`Not an image sequence: ${basename(source)}`);

		return {
			id: await hashSequence(frames),
			type: 'SEQUENCE',
			path: meta.path,
			source,
			createdAt: meta.createdAt ?? new Date().toISOString(),
			mimeType,
			width: probe.width,
			height: probe.height,
			frameRate: DEFAULT_SEQUENCE_FPS,
			duration: frames.length / DEFAULT_SEQUENCE_FPS,
			handle,
			directoryHandle: this.directoryHandle(source),
		};
	}

	/** Attaches handles to a manifest record without touching its bytes. */
	private attach(record: AssetRecord): Asset {
		if (record.type === 'SEQUENCE') {
			const first = this.fs.list(record.source).then((entries) => sortFrames(entries).find((entry) => entry.kind === 'file'));
			return {
				...record,
				handle: { getFile: async () => this.fs.file(joinPath(record.source, (await first)?.name ?? '')) },
				directoryHandle: this.directoryHandle(record.source),
			};
		}
		return {
			...record,
			handle: isUrlSource(record.source) ? this.urlHandle(record.source) : this.fileHandle(record.source),
		};
	}

	private fileHandle(source: string): AssetFileHandle {
		return { getFile: () => this.fs.file(source) };
	}

	private urlHandle(url: string): AssetFileHandle {
		let cached: Promise<File> | undefined;
		return {
			getFile: () => {
				cached ??= fetch(url).then(async (response) => {
					if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
					const blob = await response.blob();
					return new File([blob], basename(url.split(/[?#]/)[0]!), { type: blob.type });
				});
				cached.catch(() => (cached = undefined));
				return cached;
			},
		};
	}

	private directoryHandle(source: string): AssetDirectoryHandle {
		const fs = this.fs;
		return {
			async *entries() {
				const frames = sortFrames(await fs.list(source)).filter((entry) => entry.kind === 'file');
				for (const frame of frames) {
					const path = joinPath(source, frame.name);
					yield [frame.name, { kind: 'file', getFile: () => fs.file(path) }] as [string, { kind: string; getFile: () => Promise<File> }];
				}
			},
		};
	}
}

interface DescribeMeta {
	path: string;
	createdAt?: string;
}
