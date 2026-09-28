/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { assetName } from '@diffusionstudio/assets';
import { Mask } from '@diffusionstudio/reconciler';
import { AssetId, Blur, Cache, Library, getParentNode } from '@diffusionstudio/runtime';

import { getDocumentEditor } from '../editor';
import { getVideoRect } from './media';

import type { Entity, World } from 'koota';
import type { MaskAsset } from '@diffusionstudio/assets';

/** A tracked mask in the library: what an effect can be given. */
export type ObjectMaskSource = {
	asset: MaskAsset;
	/** What to call it: the mask's name in the library. */
	name: string;
	/** The clip's source time its first frame belongs to, seconds. */
	sourceIn: number;
};

/**
 * The tracked masks of `clip`'s footage, from the library: every mask file
 * whose recipe names the video the clip plays, whichever effect — or none —
 * holds it now. The recipe is the record: a mask outlives the effects that
 * used it, and the library is where it is found again.
 */
export function listObjectMasks(world: World, clip: Entity): ObjectMaskSource[] {
	const library = world.get(Library);
	const rect = getVideoRect(world, clip);
	if (!library || !rect) return [];

	const sources: ObjectMaskSource[] = [];
	for (const asset of library.list()) {
		if (asset.type !== 'MASK' || asset.recipe?.source !== rect.asset.id) continue;
		sources.push({
			asset,
			name: assetName(asset).replace(/\.[^.]+$/, ''),
			sourceIn: asset.recipe.first / asset.frameRate,
		});
	}
	return sources;
}

/** Whether `effect` already has a mask of the same frames as `source`. */
export function effectHasObjectMask(effect: Entity, source: ObjectMaskSource): boolean {
	return (effect.get(Cache)?.masks ?? []).some((mask) => mask.get(AssetId)?.value === source.asset.id);
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
