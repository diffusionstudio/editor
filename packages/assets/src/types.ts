/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { MaskRecipe } from './mask';

/** Whatever hands out the asset's bytes: a real File on desktop, an OPFS
 *  file on the web, a fetched blob for a URL. */
export interface AssetFileHandle {
	getFile(): Promise<File>;
}

/** Directory of numbered frame files backing a SEQUENCE asset. Typed to the
 *  web FileSystemDirectoryHandle surface the decoders iterate. */
export interface AssetDirectoryHandle {
	entries(): AsyncIterableIterator<[string, { kind: string; getFile?: () => Promise<File> }]>;
}

export type TranscriptWord = { text: string; start: number; end: number };

export type WordGroup = TranscriptWord[];

export type Transcript = { text: string; words: TranscriptWord[] }[];

/** Size and mtime of a source when it was last hashed/probed; a mismatch
 *  means the bytes may have changed and the asset is re-examined. */
export interface AssetStat {
	size: number;
	mtime: number;
}

interface AssetBase {
	/** Short content hash; identity of the asset. */
	id: string;
	/**
	 * Library path: `folder/sub/name.ext`, `/`-separated, no leading slash.
	 * What JSX `src` names, and what the asset panel shows. Folders are the
	 * prefixes; renaming or moving an asset changes only this.
	 */
	path: string;
	/**
	 * Where the bytes are: an absolute OS path (a linked file, left where the
	 * user had it), an `http(s)://` URL, or a project-relative path (`assets/…`,
	 * bytes the app itself produced: downloads, transcodes).
	 */
	source: string;
	createdAt: string;
	mimeType: string;
	stat?: AssetStat;
	/**
	 * Resolved on the fly for a `src` that names a path or URL outside the
	 * library; lives in memory only and is never written to the manifest.
	 */
	transient?: boolean;
	handle: AssetFileHandle;
}

export interface ImageAsset extends AssetBase {
	type: 'IMAGE';
	width: number;
	height: number;
}

export interface AudioAsset extends AssetBase {
	type: 'AUDIO';
	duration: number;
	sampleRate: number;
	channels: number;
	transcript?: Transcript;
}

export interface VideoAsset extends AssetBase {
	type: 'VIDEO';
	duration: number;
	width: number;
	height: number;
	frameRate: number;
	bitRate: number;
	sampleRate?: number;
	channels?: number;
	transcript?: Transcript;
}

export interface TranscriptAsset extends AssetBase {
	type: 'TRANSCRIPT';
}

export interface ScriptAsset extends AssetBase {
	type: 'SCRIPT';
}

// `source` is the frames directory; `handle` points to the first frame's
// file so generic preview code works.
export interface SequenceAsset extends AssetBase {
	type: 'SEQUENCE';
	width: number;
	height: number;
	frameRate: number;
	duration: number;
	directoryHandle: AssetDirectoryHandle;
}

/**
 * A tracked matte in a mask file (see `mask.ts`): the model's logits on its
 * grid, a field a frame, stretched over the footage's frame. `recipe` is how the frames were made,
 * kept here too so a mask whose file went missing can be made again.
 */
export interface MaskAsset extends AssetBase {
	type: 'MASK';
	width: number;
	height: number;
	frameRate: number;
	duration: number;
	recipe?: MaskRecipe;
}

export type Asset =
	| ImageAsset
	| AudioAsset
	| VideoAsset
	| TranscriptAsset
	| ScriptAsset
	| SequenceAsset
	| MaskAsset;

export type AssetType = Asset['type'];

/** The file name of an asset: the last segment of its library path. */
export const assetName = (asset: Pick<Asset, 'path'>): string => basename(asset.path);

/** The folder of an asset: its library path without the name, '' at root. */
export const assetFolder = (asset: Pick<Asset, 'path'>): string => dirname(asset.path);

export function basename(path: string): string {
	const trimmed = path.replace(/[/\\]+$/, '');
	const at = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
	return at < 0 ? trimmed : trimmed.slice(at + 1);
}

export function dirname(path: string): string {
	const at = path.lastIndexOf('/');
	return at < 0 ? '' : path.slice(0, at);
}

export const joinPath = (...parts: string[]): string =>
	parts.filter(Boolean).join('/').replace(/\/+/g, '/');

/** Normalizes a library path: `/`-separated, no leading/trailing/double slashes. */
export const normalizePath = (path: string): string =>
	path.replace(/\\/g, '/').split('/').filter((part) => part && part !== '.').join('/');
