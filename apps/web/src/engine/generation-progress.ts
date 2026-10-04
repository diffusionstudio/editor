/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { getAssetSpec, isTransformSpec } from '@diffusionstudio/jsx';
import { authoredElement } from '@diffusionstudio/reconciler';
import { Cache, Generating, Paint, PaintType, PendingSource } from '@diffusionstudio/runtime';
import {
	PROMPT_INPUT_AUDIO_MODEL_OPTIONS, PROMPT_INPUT_IMAGE_MODEL_OPTIONS, PROMPT_INPUT_VIDEO_MODEL_OPTIONS,
} from '@/components/genai/config';

import { templateOf } from './prompt';

import type { AssetRef } from '@diffusionstudio/jsx';
import type { Entity } from 'koota';

const HOLD = 1000;
const FADE = 300;

const IMAGE_SECONDS: Record<string, number> = {
	'flux-2-turbo': 8,
	'gpt-image-2': 60,
	'nano-banana-2': 15,
	'nano-banana-pro': 30,
	'seedream-4.5': 25,
};

const VIDEO_SECONDS: Record<string, { base: number; perSecond: number }> = {
	'kling-3-pro': { base: 40, perSecond: 12 },
	'kling-o3-pro': { base: 40, perSecond: 12 },
	'kling-2.5-turbo': { base: 30, perSecond: 8 },
	'seedance-2.0': { base: 30, perSecond: 10 },
	'veo-3.1': { base: 40, perSecond: 12 },
	'veo-3.1-fast': { base: 20, perSecond: 6 },
	'wan-2.6': { base: 40, perSecond: 10 },
	'hailuo-2.3': { base: 40, perSecond: 10 },
};

const AUDIO_SECONDS: Record<string, number> = {
	'elevenlabs-music': 30,
	'elevenlabs-sfx': 10,
};

const VOICE_SECONDS = 8;
const TRANSFORM_SECONDS = { removeBackground: 10, upscale: 20, addAudio: 45 };
const VIDEO_UPSCALE_SECONDS = 120;

type Stage = 'starting' | 'progress' | 'almost';
type Run = { start: number; stage: Stage; text: string; changedAt: number; previous: string };

const runs = new WeakMap<object, Run>();

function expectedSeconds(carrier: Entity, ref: AssetRef): number {
	const spec = getAssetSpec(ref);
	if (isTransformSpec(spec)) {
		const video = carrier.get(Paint)?.value === PaintType.VIDEO;
		return spec.type === 'upscale' && video ? VIDEO_UPSCALE_SECONDS : TRANSFORM_SECONDS[spec.type];
	}

	switch (spec.type) {
		case 'image':
			return IMAGE_SECONDS[spec.model ?? PROMPT_INPUT_IMAGE_MODEL_OPTIONS[0].id] ?? 20;
		case 'video': {
			const { base, perSecond } = VIDEO_SECONDS[spec.model ?? PROMPT_INPUT_VIDEO_MODEL_OPTIONS[0].id] ?? { base: 40, perSecond: 12 };
			return base + perSecond * (spec.duration ?? 5);
		}
		case 'voice':
			return VOICE_SECONDS;
		case 'audio':
			return AUDIO_SECONDS[spec.model ?? PROMPT_INPUT_AUDIO_MODEL_OPTIONS[0].id] ?? 20;
	}
}

export function generationLabel(entity: Entity): { text: string; opacity: number } {
	const carrier = [entity, ...(entity.get(Cache)?.fills ?? [])].find((candidate) => candidate.has(Generating));
	const token = carrier?.get(PendingSource)?.value;
	const ref = carrier && templateOf(authoredElement(carrier)?.props.src);
	if (!carrier || typeof token !== 'object' || token === null || !ref) return { text: 'Generating...', opacity: 1 };

	const now = performance.now();
	let run = runs.get(token);
	if (!run) {
		run = { start: now, stage: 'starting', text: 'Generating...', changedAt: now - FADE, previous: '' };
		runs.set(token, run);
	}

	const elapsed = now - run.start;
	const percent = Math.floor((elapsed / (expectedSeconds(carrier, ref) * 1000)) * 100);
	const stage: Stage = elapsed < HOLD ? 'starting' : percent < 100 ? 'progress' : 'almost';
	const text = stage === 'starting' ? 'Generating...' : stage === 'progress' ? `${Math.max(1, percent)}% done` : 'Almost done...';

	if (stage !== run.stage) {
		run.previous = run.text;
		run.stage = stage;
		run.changedAt = now;
	}
	run.text = text;

	const fade = (now - run.changedAt) / (FADE / 2);
	return fade < 1 ? { text: run.previous, opacity: 1 - fade } : { text, opacity: Math.min(1, fade - 1) };
}
