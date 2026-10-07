/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { assetName } from '@diffusionstudio/assets';
import { Mask } from '@diffusionstudio/reconciler';
import { AssetId, Blur, Cache, Library, Mask as MaskTrait, getParentNode } from '@diffusionstudio/runtime';

import { getDocumentEditor } from '../editor';
import { getMaskRestoreOf } from './tracking';

import type { Entity, World } from 'koota';
import type { AssetLibrary, MaskAsset } from '@diffusionstudio/assets';

/** A tracked mask in the library: what an effect can be given. */
export type ObjectMaskSource = {
	asset: MaskAsset;
	/** What to call it: the mask's name in the library. */
	name: string;
	/** The clip's source time its first frame belongs to, seconds. */
	sourceIn: number;
};

/** A section of the mask menus: a heading and the masks under it. */
export type ObjectMaskGroup = {
	/** What to call the section. */
	name: string;
	masks: ObjectMaskSource[];
};

/**
 * Every mask in `library`, the ones tracked on the video `footage` (its asset
 * id, the clip's own footage) first, under that video's name, and all the
 * others after them as "Others" — any effect can take any mask, but the
 * clip's own are the likely pick. Empty sections are left out. It reads the
 * library's asset list, a signal, so a memo over it runs again only when the
 * library changes (see `useObjectMasks`).
 */
export function objectMaskGroups(library: AssetLibrary, footage: string | null): ObjectMaskGroup[] {
	const video = footage ? library.get(footage) : undefined;
	const own: ObjectMaskGroup = { name: video ? assetName(video).replace(/\.[^.]+$/, '') : '', masks: [] };
	const others: ObjectMaskGroup = { name: 'Others', masks: [] };

	for (const asset of library.list()) {
		if (asset.type !== 'MASK') continue;
		const group = video && asset.recipe?.source === video.id ? own : others;
		group.masks.push({
			asset,
			name: assetName(asset).replace(/\.[^.]+$/, ''),
			sourceIn: asset.recipe ? asset.recipe.first / asset.frameRate : 0,
		});
	}
	return [own, others].filter((group) => group.masks.length > 0);
}

/**
 * Puts the tracked frames of `source` under `effect` as a `<mask>` of its
 * own: the frames, placed at the source time they were written for. The feather carries over from another mask of the same frames on the
 * clip when there is one; inversion and strength start fresh — a mask shared
 * with a blur is usually the cut-out's inverse. Returns the new mask, or
 * null when the effect cannot be written to.
 */
export function copyObjectMask(world: World, effect: Entity, source: ObjectMaskSource): Entity | null {
	const blur = featherOf(effect, source);
	const [mask] = getDocumentEditor(world).insertElement(effect, () => (
		<Mask
			src={source.asset.path}
			{...(source.sourceIn > 0 ? { sourceIn: source.sourceIn } : {})}
			{...(blur ? { blur } : {})}
		/>
	));
	return mask ?? null;
}

/**
 * Deletes the tracked frames of `source`: every `<mask>` naming them leaves
 * the document, wherever it is, and the file leaves the library — a mask
 * without its frames would only fail to load. A restore of the file is
 * stopped, since there is nothing left for it to write back to.
 */
export async function removeObjectMask(world: World, source: ObjectMaskSource): Promise<void> {
	const id = source.asset.id;
	const users = world.query(MaskTrait, AssetId).filter((mask) => mask.get(AssetId)?.value === id);

	if (users.length > 0) {
		getDocumentEditor(world).remove(users);
	}

	getMaskRestoreOf(source.asset)?.controller.abort();

	await world.get(Library)?.remove([source.asset]);
}

/** The feather another mask of the same frames has, anywhere on the effect's clip. */
function featherOf(effect: Entity, source: ObjectMaskSource): number | undefined {
	const node = getParentNode(effect);
	for (const sibling of node?.get(Cache)?.effects ?? [effect]) {
		for (const mask of sibling.get(Cache)?.masks ?? []) {
			if (mask.get(AssetId)?.value === source.asset.id) return mask.get(Blur)?.value;
		}
	}
	return undefined;
}
