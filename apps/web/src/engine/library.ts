/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The asset library in the app: attached to the world for the project on
// disk and kept in step with the JSX (a rename in the library is a `src`
// edit in the file).

import { AssetId, Library } from '@diffusionstudio/runtime';
import { AssetLibrary, MANIFEST_FILE, ASSETS_DIR, isUrlSource } from '@diffusionstudio/assets';
import { useTrait, useWorld } from '@diffusionstudio/koota-solid';
import { authoredElement } from '@diffusionstudio/reconciler';
import { isAssetRef, mapAssetInputs } from '@diffusionstudio/jsx';
import type { Accessor } from 'solid-js';

import { createProjectFS } from '@/projects/fs';
import { getDocumentEditor } from './editor';

import type { Asset } from '@diffusionstudio/assets';
import type { AssetInput } from '@diffusionstudio/jsx';
import type { World } from 'koota';

const locations = new WeakMap<World, (source: string) => string>();

/**
 * Creates the library of the project at `dir`, attaches it to the world and
 * starts loading it. Renames in the library are written through to every
 * element whose `src` named the old path. Returns the library and a
 * disposer that flushes the manifest and detaches it.
 */
export function attachLibrary(world: World, dir: string) {
	const fs = createProjectFS(dir);
	if (fs.absolute) locations.set(world, fs.absolute);
	const library = new AssetLibrary(fs, {
		onRename: (asset, from) => followRename(world, asset, from),
		onRelink: (asset, from) => followRelink(world, asset, from),
	});

	world.set(Library, library);

	return library;
}

export function assetFilePath(world: World, asset: Asset): string | undefined {
	return isUrlSource(asset.source) ? undefined : locations.get(world)?.(asset.source);
}

/** Whether a changed project file is the library's business rather than the JSX's. */
export function isLibraryFile(path: string): boolean {
	return path === MANIFEST_FILE || path === ASSETS_DIR || path.startsWith(`${ASSETS_DIR}/`);
}

/**
 * Rewrites `src` on every element that named an asset by its old path —
 * directly, or as an input somewhere inside a declaration: an element
 * showing `transform.upscale("old.png")` is bound to what the transform made,
 * and its `src` still has to follow the rename.
 */
function followRename(world: World, asset: Asset, from: string): void {
	const editor = getDocumentEditor(world);
	const renamed = (input: AssetInput): AssetInput =>
		isAssetRef(input) ? mapAssetInputs(input, renamed) : input === from ? asset.path : input;

	for (const entity of world.query(AssetId)) {
		const src = authoredElement(entity)?.props.src;
		if (typeof src !== 'string' && !isAssetRef(src)) continue;
		const next = renamed(src);
		if (next !== src) editor.editProperty(entity, 'src', next);
	}
}

/** Rebinds every element bound to a relinked asset's old id to its new one. */
function followRelink(world: World, asset: Asset, from: string): void {
	for (const entity of world.query(AssetId)) {
		if (entity.get(AssetId)?.value === from) entity.set(AssetId, { value: asset.id });
	}
}

/**
 * The world's library, or undefined until a project attaches one. The
 * library's own state is reactive (`assets()`, `folders()`, `childrenOf()`),
 * so readers inside a tracking scope follow it.
 */
export function useLibrary(): Accessor<AssetLibrary | undefined> {
	const world = useWorld();
	const attached = useTrait(world, Library);
	return () => attached() ?? undefined;
}
