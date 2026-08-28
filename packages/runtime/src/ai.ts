/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { generate } from '@diffusionstudio/jsx';

import type { Entity, World } from '@diffusionstudio/koota';
import type { Asset } from '@diffusionstudio/assets';
import type { SourceModifierValues } from './actions/assets';
import type {
	AssetRef,
	GenerateAudioOptions,
	GenerateImageOptions,
	GenerateVideoOptions,
	GenerateVoiceOptions,
} from '@diffusionstudio/jsx';

export abstract class GenAi {
	/**
	 * The declaration, made real: an asset whose bytes the model produced.
	 * Content-addressed — the fully-resolved spec's hash is the asset's
	 * `generation.key`, so the same spec is the same asset in this session
	 * and the next, and identical concurrent declarations share one run.
	 */
	public abstract resolve(ref: AssetRef): Promise<Asset>;

	/**
	 * The transcript of `scene`'s audible mix, as a TRANSCRIPT asset of the
	 * project's library. Cached by scene id + seed: the same pair resolves to
	 * the same asset, in this session and the next, and a new seed transcribes
	 * the scene again. Identical concurrent requests share one run.
	 */
	public abstract transcribe(world: World, scene: Entity, seed: number): Promise<Asset>;

	/**
	 * `asset` put through the modifiers an element asked of its source (see
	 * `SourceModifiers`): the same asset and the same modifiers are the same
	 * result, in this session and the next, and every step is cached on its
	 * own, so adding one to an element does not re-run the others.
	 */
	public abstract derive(asset: Asset, modifiers: SourceModifierValues): Promise<Asset>;

	/**
	 * The imperative surface: `ai.generate.image({...})` declares and resolves
	 * in one call, returning the finished asset.
	 */
	public readonly generate = {
		image: (options: GenerateImageOptions): Promise<Asset> => this.resolve(generate.image(options)),
		video: (options: GenerateVideoOptions): Promise<Asset> => this.resolve(generate.video(options)),
		voice: (options: GenerateVoiceOptions): Promise<Asset> => this.resolve(generate.voice(options)),
		audio: (options: GenerateAudioOptions): Promise<Asset> => this.resolve(generate.audio(options)),
	};
}
