/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A project's first scene, and the assets that started it. Dropping media
// into a project that has no scene to put it in makes one around it rather
// than leaving the clips loose at the root, which is what `insertAsset`
// would otherwise do. The canvas and the timeline share this; they differ
// only in where the new scene should end up on screen.

import { Scene as SceneElement, SolidPaint } from '@diffusionstudio/reconciler';
import { focusRect, getCameraMatrix, getNextName, Root, Source } from '@diffusionstudio/runtime';

import { getDocumentEditor } from './editor';
import { AUDIO_SIZE, insertAsset } from './insert-asset';

import type { Asset } from '@diffusionstudio/assets';
import type { Rect } from '@diffusionstudio/runtime';
import type { Entity, World } from '@diffusionstudio/koota';

export interface Size {
	width: number;
	height: number;
}

/** The format a new scene gets when nothing going into it brings one. */
export const DEFAULT_SCENE_FORMAT: Size = { width: 1920, height: 1080 };

export interface NewSceneOptions {
	/** The scene's name; the next free "Scene N" by default. */
	name?: string;
	/** The format to fall back to when no asset has one of its own. */
	format?: Size;
	/**
	 * Brings the new scene into view, given the rect it occupies in world
	 * space. The camera is framed on it by default; the canvas placeholder
	 * puts it exactly where the placeholder was instead.
	 */
	focus?: (rect: Rect) => void;
	/** Where on the timeline the assets start, in seconds; the playhead by default. */
	start?: number;
}

/**
 * Adds the project's first scene, of `format`, centered on the world origin,
 * makes it the active one, and brings it into view. Returns the scene, or
 * null when there is no project for it to be written under.
 */
export function createScene(world: World, format: Size, options: NewSceneOptions = {}): Entity | null {
	const root = world.get(Root)!;
	if (!root.get(Source)?.value) return null;

	const editor = getDocumentEditor(world);
	const rect: Rect = { x: Math.round(-format.width / 2), y: Math.round(-format.height / 2), ...format };
	const name = options.name ?? getNextName(world, 'Scene');

	// The camera moves first, so the scene is in view the moment it exists.
	(options.focus ?? ((target: Rect) => focusRect(world, target)))(rect);
	editor.reportEdit(root, 'camera', getCameraMatrix(world));

	const [scene] = editor.insertElement(root, () => (
		<SceneElement name={name} x={rect.x} y={rect.y} width={rect.width} height={rect.height}>
			<SolidPaint color="#000000" />
		</SceneElement>
	));
	if (!scene) return null;

	editor.activate(scene);
	return scene;
}

/**
 * Puts `assets` in a scene of their own and selects them. The scene's format
 * is the last asset that has a size of its own — that one fills the scene
 * exactly, and the rest are centered in it; a drop of nothing but audio or a
 * transcript falls back to `options.format`. Returns the scene, or null when
 * there is nothing to insert into.
 */
export function insertAssetsInNewScene(
	world: World,
	assets: ReadonlyArray<Asset>,
	options: NewSceneOptions = {},
): Entity | null {
	const sized = assets.findLast(hasSize);
	const format = sized ? sizeOf(sized) : options.format ?? DEFAULT_SCENE_FORMAT;

	const scene = createScene(world, format, options);
	if (!scene) return null;

	const inserted: Entity[] = [];
	for (const asset of assets) {
		const size = hasSize(asset) ? sizeOf(asset) : AUDIO_SIZE;
		const entity = insertAsset(world, asset, {
			parent: scene,
			// The scene is new, so its computed bounds are not there to center
			// against yet: the format is what it will measure.
			x: (format.width - size.width) / 2,
			y: (format.height - size.height) / 2,
			start: options.start,
		});
		if (entity) inserted.push(entity);
	}

	getDocumentEditor(world).select(inserted.length ? inserted : scene);
	return scene;
}

/** Assets that bring a format with them; the rest are laid out inside one. */
export const hasSize = (asset: Asset): asset is Extract<Asset, Size> => 'width' in asset && 'height' in asset;

export const sizeOf = (asset: Extract<Asset, Size>): Size => ({
	width: Math.round(asset.width),
	height: Math.round(asset.height),
});
