/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { store } from '../world/store';
import { Muted, Computed, AudioEngine } from '../traits';
import { attempt } from '../utils/async';
import { assert } from '../utils/assert';

import type { Entity, World } from '@diffusionstudio/koota';

/**
 * Per-entity audio bus. Each clip and each scene gets its own gain node.
 * Child buses connect directly into the parent bus's input; there is no
 * per-track sub-mix anymore (each clip is its own layer).
 */
export class AudioBus {
	public context: BaseAudioContext;

	private gain: GainNode;
	private entity: Entity;
	private world: World;
	private _input: AudioNode;

	public constructor(world: World, entity: Entity) {
		const context = world.get(AudioEngine)?.context;
		assert(context, 'World has no audio context');
		this.context = context;
		this.gain = context.createGain();
		this._input = this.gain;
		this.entity = entity;
		this.world = world;
	}

	public get input(): AudioNode {
		return this._input;
	}

	public getGain(): GainNode {
		return this.gain;
	}

	public sync(): void {
		this.gain.gain.value = this.getVolume();
	}

	public connect(node: AudioNode) {
		this.gain.connect(node);
	}

	public mute(): void {
		this.gain.gain.value = 0;
	}

	public disconnect() {
		attempt(() => this.gain.disconnect());
		this._input = this.gain;
	}

	private getVolume(): number {
		const volumeDb = store(this.world, Computed).volume[this.entity.id()] ?? 0;
		const muted = this.entity.has(Muted);

		/** Minimum dB value: treated as silence (maps to linear gain 0). */
		if (muted || volumeDb === -Infinity) {
			return 0;
		}

		return Math.pow(10, volumeDb / 20);
	}
}
