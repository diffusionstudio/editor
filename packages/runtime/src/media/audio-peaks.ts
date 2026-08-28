/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { derivePeaks } from '@diffusionstudio/assets';

import { Library, WaveformHandle, AssetId } from '../traits';
import { getAsset, getAssetFile } from '../actions/assets';

import type { Entity, World } from '@diffusionstudio/koota';
import type { AssetCache, AudioAsset, VideoAsset } from '@diffusionstudio/assets';

/**
 * What a waveform paint's entity holds while it is on screen: the peaks of
 * its asset once they have loaded. Released on cull like the decoders.
 */
export class Waveform {
	public readonly asset: AudioAsset | VideoAsset;
	public readonly cache?: AssetCache;
	public peaks: Uint8ClampedArray | null = null;
	public initialized: Promise<void> | undefined;

	private disposed = false;

	public constructor(asset: AudioAsset | VideoAsset, cache?: AssetCache) {
		this.asset = asset;
		this.cache = cache;
		this.initialized = this.initialize();
	}

	private async initialize(): Promise<void> {
		// Through the cache where there is one, so a file's peaks are derived
		// once per project rather than once per session.
		const peaks = this.cache
			? await this.cache.peaks(this.asset)
			: await derivePeaks(await getAssetFile(this.asset));

		if (!this.disposed) {
			this.peaks = peaks;
		}
	}

	public dispose(): void {
		this.disposed = true;
		this.peaks = null;
	}
}

/**
 * The peaks for a waveform paint, synchronously for the render loop: what the
 * paint entity holds, or null while they load (the load is started here).
 */
export function resolveWaveformPeaks(world: World, fill: Entity): Uint8ClampedArray | null {
	const assetId = fill.get(AssetId)?.value;
	if (!assetId) return null;

	const existing = fill.get(WaveformHandle);

	if (existing && existing.asset.id === assetId) {
		return existing.peaks;
	}

	existing?.dispose();

	const asset = getAsset(world, assetId);
	// Both AUDIO and VIDEO assets carry peaks (video has audio).
	if (asset?.type !== 'AUDIO' && asset?.type !== 'VIDEO') return null;

	const waveform = new Waveform(asset, world.get(Library)?.cache);
	fill.add(WaveformHandle);
	fill.set(WaveformHandle, waveform);
	return waveform.peaks;
}
