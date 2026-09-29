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

/**
 * The tracked masks of the video `footage` (its asset id) in `library`: every
 * mask file whose recipe names it, whichever effect — or none — holds it now.
 * The recipe is the record: a mask outlives the effects that used it, and
 * the library is where it is found again. It reads the library's asset list,
 * a signal, so a memo over it runs again only when the library changes (see
 * `useObjectMasks`).
 */
export function objectMasksOf(library: AssetLibrary, footage: string): ObjectMaskSource[] {
	const sources: ObjectMaskSource[] = [];
	for (const asset of library.list()) {
		if (asset.type !== 'MASK' || asset.recipe?.source !== footage) continue;
		sources.push({
			asset,
			name: assetName(asset).replace(/\.[^.]+$/, ''),
			sourceIn: asset.recipe.first / asset.frameRate,
		});
	}
	return sources;
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
