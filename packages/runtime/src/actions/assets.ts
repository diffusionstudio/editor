/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Reading assets out of the world. Everything that changes the asset set
// goes through the AssetLibrary (@diffusionstudio/assets); these are the
// lookups the decoders and hosts share.

import { Ai, AssetId, Library, Paint, SourceFrameRate, SourceModifiers } from '../traits';
import { PaintType } from '../constants';

import type { Entity, World } from '@diffusionstudio/koota';
import type { Asset, AssetLibrary, SequenceAsset } from '@diffusionstudio/assets';
import type { GenAi } from '../ai';

/** The world's asset library; throws when the host attached none. */
export function getLibrary(world: World): AssetLibrary {
	const library = world.get(Library);
	if (!library) throw new Error('This world has no asset library');
	return library;
}

/** The world's generation service; throws when the host attached none. */
export function getAi(world: World): GenAi {
	const ai = world.get(Ai);
	if (!ai) throw new Error('This world cannot generate assets (no Ai attached)');
	return ai;
}

/** What a source is put through after it resolves (see `SourceModifiers`). */
export interface SourceModifierValues {
	removeBackground: boolean;
	/** Factor, 1 = natural size. */
	upscale: number;
	addAudio: boolean;
}

/** Whether a set of modifiers asks for anything at all. */
export const hasModifier = (modifiers: SourceModifierValues): boolean =>
	modifiers.removeBackground || modifiers.upscale > 1 || modifiers.addAudio;

/**
 * The modifiers `entity` asks its source to be put through, or undefined
 * when it asks for none — which is what the trait's absence means, so this
 * is also the question "is this element showing a derived source".
 */
export function getModifiers(entity: Entity): SourceModifierValues | undefined {
	const modifiers = entity.get(SourceModifiers);
	return modifiers && hasModifier(modifiers) ? modifiers : undefined;
}

/**
 * Binds an entity to an asset: stamps its AssetId, and follows the asset with
 * the paint. A media paint is whichever of the two the asset can be drawn
 * through — a frames directory decodes and draws exactly as a video does, so
 * it paints as one — and it is re-decided on every bind, so an element handed
 * a different kind of source shows it rather than nothing at all. Paints that
 * are not media (a gradient, a shader) are left alone: their fill is not the
 * asset.
 */
export function bindAsset(entity: Entity, asset: Asset): void {
	entity.add(AssetId);
	entity.set(AssetId, { value: asset.id });

	const paint = entity.get(Paint)?.value;
	if (paint !== PaintType.IMAGE && paint !== PaintType.VIDEO) return;

	const wanted = asset.type === 'IMAGE' ? PaintType.IMAGE
		: asset.type === 'VIDEO' || asset.type === 'SEQUENCE' ? PaintType.VIDEO
		// Audio and transcripts have nothing to draw; leave the paint as authored.
		: paint;

	if (wanted !== paint) entity.set(Paint, { value: wanted });
}

/**
 * The rate a frames directory is played at: the element's own `frameRate`
 * when it sets one, else the rate the library gave the asset. `ignoreAuthored`
 * reads the element's as absent, for a handler of its removal.
 */
export function getSequenceFrameRate(entity: Entity, asset: SequenceAsset, ignoreAuthored = false): number {
	const authored = ignoreAuthored ? 0 : entity.get(SourceFrameRate)?.value ?? 0;
	return authored > 0 ? authored : asset.frameRate;
}

/**
 * How long the asset lasts as `entity` plays it, in seconds, or null when it
 * is not something with a duration. Only a sequence's answer depends on the
 * entity: its frames are a count, and the rate turning that into a duration
 * is the element's to set.
 */
export function getSourceDuration(entity: Entity, asset: Asset, ignoreAuthoredRate = false): number | null {
	if (asset.type === 'SEQUENCE') {
		const frames = asset.duration * asset.frameRate;
		return frames / getSequenceFrameRate(entity, asset, ignoreAuthoredRate);
	}

	if (asset.type === 'AUDIO' || asset.type === 'VIDEO') return asset.duration;
	return null;
}

/** The asset with `id` (or at that library path), or undefined without a library. */
export function getAsset(world: World, idOrPath: string): Asset | undefined {
	return world.get(Library)?.get(idOrPath);
}

const assetFileCache = new WeakMap<Asset['handle'], Promise<File>>();

/**
 * Returns the File backing an asset, reusing an in-flight or already-resolved
 * read for the same handle.
 */
export function getAssetFile(asset: Pick<Asset, 'handle'>): Promise<File> {
	const { handle } = asset;
	const cached = assetFileCache.get(handle);
	if (cached) return cached;

	const promise = handle.getFile();
	assetFileCache.set(handle, promise);
	promise.catch(() => {
		if (assetFileCache.get(handle) === promise) {
			assetFileCache.delete(handle);
		}
	});
	return promise;
}

/** Returns the File/Blob backing an asset, or null if the asset is missing. */
export async function getAssetBlob(world: World, id: string): Promise<Blob | null> {
	const asset = getAsset(world, id);
	if (!asset) return null;

	return await getAssetFile(asset);
}
