/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


import { normalizePath } from './types';

import type { Asset } from './types';

export const MANIFEST_VERSION = 1;

/** The manifest's file name (with the YAML extension; the codec is the host's). */
export const MANIFEST_FILE = 'assets.yml';

/** The project directory the app writes its own asset bytes into. */
export const ASSETS_DIR = 'assets';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An asset as written to the manifest: the model minus its runtime handles. */
export type AssetRecord = DistributiveOmit<Asset, 'handle' | 'directoryHandle' | 'transient'>;

export interface Manifest {
	version: number;
	/**
	 * Every folder of the library, including empty ones (a folder with assets
	 * in it is also implied by their paths). `/`-separated, no leading slash.
	 */
	folders: string[];
	/** Assets, newest first. */
	assets: AssetRecord[];
}

const RECORD_KEYS = new Set(['handle', 'directoryHandle', 'transient']);

/** The manifest record of an asset: its data, none of its handles. */
export function toRecord(asset: Asset): AssetRecord {
	const record: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(asset)) {
		if (RECORD_KEYS.has(key) || value === undefined) continue;
		record[key] = value;
	}
	return record as AssetRecord;
}

/** Whether `record` has what every asset needs; unrecognized fields are kept. */
export function isAssetRecord(record: unknown): record is AssetRecord {
	if (!record || typeof record !== 'object') return false;
	const r = record as Record<string, unknown>;
	return (
		typeof r.id === 'string' && r.id.length > 0 &&
		typeof r.path === 'string' && r.path.length > 0 &&
		typeof r.source === 'string' && r.source.length > 0 &&
		typeof r.type === 'string' &&
		typeof r.mimeType === 'string'
	);
}

/**
 * Reads whatever the host handed back as a manifest into a well-formed one.
 * Tolerant: a missing or malformed file is an empty library, and a broken
 * record is dropped rather than taking the rest of the library with it.
 */
export function normalizeManifest(input: unknown): Manifest {
	const manifest: Manifest = { version: MANIFEST_VERSION, folders: [], assets: [] };
	if (!input || typeof input !== 'object') return manifest;

	const raw = input as Record<string, unknown>;
	if (Array.isArray(raw.folders)) {
		for (const folder of raw.folders) {
			if (typeof folder !== 'string') continue;
			const path = normalizePath(folder);
			if (path && !manifest.folders.includes(path)) manifest.folders.push(path);
		}
	}

	if (Array.isArray(raw.assets)) {
		const seen = new Set<string>();
		for (const record of raw.assets) {
			if (!isAssetRecord(record)) continue;
			const path = normalizePath(record.path);
			if (!path || seen.has(record.id)) continue;
			seen.add(record.id);
			manifest.assets.push({ ...record, path });
		}
	}

	return manifest;
}

/** Whether a source is a URL rather than a path. */
export const isUrlSource = (source: string): boolean => /^https?:\/\//i.test(source);

/** Whether a source is an absolute OS path (POSIX or Windows). */
export const isAbsoluteSource = (source: string): boolean =>
	source.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(source) || source.startsWith('\\\\');

/** Whether a source is a path inside the project (neither URL nor absolute). */
export const isProjectSource = (source: string): boolean =>
	!isUrlSource(source) && !isAbsoluteSource(source);
