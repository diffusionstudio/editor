/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { cubicBezier, steps, spring } from 'animejs';

import { store } from '../world/store';
import {
	Geometry, Group, AdjustmentLayer, Hidden, Culled,
	Computed, Cache, Animation, KeyframeTrack, Keyframe, Chars,
	UniformScale, Position, Offset, Rotation, Scale, Skew, Size, Opacity,
	Color, Blur, Volume, Effect, StrokeStyle, CornerRadius, MixedCornerRadius,
	ColorStop,
} from '../traits';
import { AnimationType, AnimationPhase } from '../constants';
import { revealChars, revealWords, scrambleChars } from '../utils/text-motion';
import { getLocalWindow } from '../utils/time';

import type { Entity, Trait, TraitRecord, World } from 'koota';

/**
 * Reset an entity's Computed values back to its authored trait values.
 * Motion (animations + keyframes) then layers on top each frame. A trait
 * the entity does not carry counts as its default: koota leaves store slots
 * as they were when a trait is removed, so the slot alone cannot say.
 * `ignore` treats one more trait as absent, for onRemove handlers (koota
 * fires them before the trait is cleared).
 */
export function resetAnimatedValues(world: World, entity: Entity | null, ignore?: Trait) {
	if (entity === null) return;

	const computed = store(world, Computed);
	const eid = entity.id();
	const read = <T extends Trait, K extends keyof TraitRecord<T>>(trait: T, field: K, fallback: TraitRecord<T>[K]): TraitRecord<T>[K] => {
		if (trait === ignore || !entity.has(trait)) return fallback;
		return (store(world, trait) as Record<K, TraitRecord<T>[K][]>)[field][eid] ?? fallback;
	};

	computed.positionX[eid] = read(Position, 'x', 0);
	computed.positionY[eid] = read(Position, 'y', 0);
	computed.offsetX[eid] = read(Offset, 'x', 0);
	computed.offsetY[eid] = read(Offset, 'y', 0);
	computed.rotation[eid] = read(Rotation, 'value', 0);
	computed.skewX[eid] = read(Skew, 'x', 0);
	computed.skewY[eid] = read(Skew, 'y', 0);
	computed.opacity[eid] = read(Opacity, 'value', 1);
	computed.color[eid] = read(Color, 'value', 0);
	computed.blur[eid] = read(Blur, 'value', 0);
	computed.volume[eid] = read(Volume, 'value', 0);
	computed.strokeWidth[eid] = read(StrokeStyle, 'width', 1);
	computed.cornerRadius[eid] = read(CornerRadius, 'value', 0);
	computed.cornerRadiusTopLeft[eid] = read(MixedCornerRadius, 'topLeft', 0);
	computed.cornerRadiusTopRight[eid] = read(MixedCornerRadius, 'topRight', 0);
	computed.cornerRadiusBottomRight[eid] = read(MixedCornerRadius, 'bottomRight', 0);
	computed.cornerRadiusBottomLeft[eid] = read(MixedCornerRadius, 'bottomLeft', 0);
	computed.stopOffset[eid] = read(ColorStop, 'offset', 0);
	computed.chars[eid] = read(Chars, 'value', '');

	if (entity.has(UniformScale) && ignore !== UniformScale) {
		computed.scaleX[eid] = read(UniformScale, 'value', 1);
		computed.scaleY[eid] = read(UniformScale, 'value', 1);
	} else {
		computed.scaleX[eid] = read(Scale, 'x', 1);
		computed.scaleY[eid] = read(Scale, 'y', 1);
	}
}

/**
 * Apply a preset animation to a node at the given normalized progress.
 */
function applyAnimation(world: World, entity: Entity, anim: Entity, progress: number) {
	const computed = store(world, Computed);
	const animation = store(world, Animation);
	const chars = store(world, Chars);
	const eid = entity.id();
	const aid = anim.id();

	switch (animation.type[aid]) {
		case AnimationType.FADE: {
			const phase = animation.phase[aid];
			const func = cubicBezier(0.1, 0.7, 0.5, 1);
			const eased = clamp01(func(progress));
			computed.opacity[eid] = phase === AnimationPhase.OUT ? 1 - eased : eased;
			break;
		}
		case AnimationType.GAIN: {
			const phase = animation.phase[aid];
			const func = cubicBezier(0.4, 0.095, 0.546, 0.875);
			const eased = clamp01(func(progress));
			const amplitude = phase === AnimationPhase.OUT ? 1 - eased : eased;
			computed.volume[eid] = (computed.volume[eid] ?? 0) + amplitudeToDecibels(amplitude);
			break;
		}
		case AnimationType.GROW: {
			const phase = animation.phase[aid];
			const func = cubicBezier(0.1, 0.7, 0.5, 1);
			const eased = clamp01(func(progress));
			const t = phase === AnimationPhase.OUT ? eased : 1 - eased;
			const scale = 1 - 0.5 * t;
			computed.scaleX[eid] = scale;
			computed.scaleY[eid] = scale;
			break;
		}
		case AnimationType.SHRINK: {
			const phase = animation.phase[aid];
			const func = cubicBezier(0.1, 0.7, 0.5, 1);
			const eased = clamp01(func(progress));
			const t = phase === AnimationPhase.OUT ? eased : 1 - eased;
			const scale = 1 + 0.5 * t;
			computed.scaleX[eid] = scale;
			computed.scaleY[eid] = scale;
			break;
		}
		case AnimationType.BLUR: {
			const phase = animation.phase[aid];
			const func = phase === AnimationPhase.OUT ? cubicBezier(0.4, 0, 1, 1) : cubicBezier(0.33, 0, 0.2, 1);
			const eased = clamp01(func(progress));
			computed.blur[eid] = phase === AnimationPhase.OUT ? lerp(0, 24, eased) : lerp(24, 0, eased);
			break;
		}
		case AnimationType.SLIDE_LEFT:
		case AnimationType.SLIDE_RIGHT:
		case AnimationType.SLIDE_UP:
		case AnimationType.SLIDE_DOWN: {
			const phase = animation.phase[aid];
			const type = animation.type[aid];
			const func = cubicBezier(0.1, 0.7, 0.5, 1);
			const eased = clamp01(func(progress));
			const t = phase === AnimationPhase.OUT ? eased : 1 - eased;

			const sign = phase === AnimationPhase.OUT ? -1 : 1;
			if (type === AnimationType.SLIDE_LEFT) {
				computed.offsetX[eid] = sign * 100 * t;
			} else if (type === AnimationType.SLIDE_RIGHT) {
				computed.offsetX[eid] = sign * -100 * t;
			} else if (type === AnimationType.SLIDE_UP) {
				computed.offsetY[eid] = sign * 100 * t;
			} else if (type === AnimationType.SLIDE_DOWN) {
				computed.offsetY[eid] = sign * -100 * t;
			}
			computed.opacity[eid] = 1 - t;
			break;
		}
		case AnimationType.SPIN: {
			const phase = animation.phase[aid];
			const func = cubicBezier(0.44, 0.02, 0.252, 0.992);
			const eased = clamp01(func(progress));
			const t = phase === AnimationPhase.OUT ? eased : 1 - eased;
			const scale = 1 - t;
			computed.scaleX[eid] = scale;
			computed.scaleY[eid] = scale;
			computed.rotation[eid] = -45 * t;
			break;
		}
		case AnimationType.TWIST: {
			const phase = animation.phase[aid];
			const func = cubicBezier(0.1, 0.7, 0.5, 1);
			const eased = clamp01(func(progress));
			const t = phase === AnimationPhase.OUT ? eased : 1 - eased;
			const scale = 1 + t;
			computed.scaleX[eid] = scale;
			computed.scaleY[eid] = scale;
			computed.rotation[eid] = -10 * t;
			computed.offsetX[eid] = -30 * t;
			computed.offsetY[eid] = -30 * t;
			break;
		}
		case AnimationType.APPEAR_WORD: {
			const phase = animation.phase[aid];
			const t = phase === AnimationPhase.OUT ? progress : 1 - progress;
			computed.chars[eid] = revealWords(chars.value[eid] ?? '', 1 - t);
			break;
		}
		case AnimationType.APPEAR_CHAR: {
			const phase = animation.phase[aid];
			const t = phase === AnimationPhase.OUT ? progress : 1 - progress;
			computed.chars[eid] = revealChars(chars.value[eid] ?? '', 1 - t);
			break;
		}
		case AnimationType.SCRAMBLE: {
			const phase = animation.phase[aid];
			const t = phase === AnimationPhase.OUT ? progress : 1 - progress;
			computed.chars[eid] = scrambleChars(chars.value[eid] ?? '', 1 - t);
			break;
		}
	}
}

export function motionSystem(world: World): void {
	const computed = store(world, Computed);
	const cache = store(world, Cache);
	const animation = store(world, Animation);
	const keyframeTrack = store(world, KeyframeTrack);
	const worldProps = getPropertyPaths(world);

	// Keep the node union and exclusions out of Koota's compound query. In the
	// editor world these traits span internal bitmask generations, and Koota
	// 0.6 can otherwise drop valid nodes entirely.
	const nodes = new Set([
		...world.query(Geometry),
		...world.query(Group),
		...world.query(AdjustmentLayer),
	]);
	for (const entity of nodes) {
		if (entity.has(Hidden) || entity.has(Culled)) continue;
		const eid = entity.id();

		if (computed.visibility[eid] === 0) continue;

		const animations = cache.animations[eid] ?? [];
		const keyframeTracks = cache.keyframeTracks[eid] ?? [];
		if (animations.length === 0 && keyframeTracks.length === 0) continue;

		resetAnimatedValues(world, entity);

		const source = getLocalWindow(entity);

		const localFrame = computed.localTime[eid];

		// 1: Preset animations (FADE/GAIN/GROW/SHRINK/BLUR/SLIDE)
		for (const anim of animations) {
			const aid = anim.id();
			const duration = animation.duration[aid] ?? 0;
			if (duration <= 0) continue;

			const delay = animation.delay[aid] ?? 0;
			const isOut = animation.phase[aid] === AnimationPhase.OUT;
			const windowStart = isOut
				? source.out - duration - delay
				: source.in + delay;
			const windowEnd = windowStart + duration;
			if (isOut ? localFrame < windowStart : localFrame >= windowEnd) continue;

			const progress = clamp01((localFrame - windowStart) / Math.max(1, duration - 1));
			applyAnimation(world, entity, anim, progress);
		}

		// 2: Keyframe tracks
		let uniformScale = entity.has(UniformScale);
		for (const track of keyframeTracks) {
			const tid = track.id();
			const property = keyframeTrack.property[tid] as PropertyPath;
			const target = keyframeTrack.target[tid];
			const keyframes = cache.keyframes[tid] ?? [];
			const result = sampleTrack(world, keyframes, localFrame, property);
			if (result === null || target == null) continue;
			worldProps[property].computed[target.id()] = result;
			// A 'scale' track is the uniform scale whether or not the node also
			// authors the prop, so it scales both axes like UniformScale does.
			if (property === 'scale' && target === entity) uniformScale = true;
		}

		// Uniform scale is authored/animated as scaleX only; mirror it onto scaleY.
		if (uniformScale) {
			computed.scaleY[eid] = computed.scaleX[eid];
		}
	}
}

/**
 * Keyframeable properties: dot-path string to the computed (per-frame
 * resolved) and authored (document) store arrays.
 */
export function getPropertyPaths(world: World) {
	const computed = store(world, Computed);
	return {
		'position.x': {
			computed: computed.positionX,
			authored: store(world, Position).x,
		},
		'position.y': {
			computed: computed.positionY,
			authored: store(world, Position).y,
		},
		'offset.x': {
			computed: computed.offsetX,
			authored: store(world, Offset).x,
		},
		'offset.y': {
			computed: computed.offsetY,
			authored: store(world, Offset).y,
		},
		'rotation': {
			computed: computed.rotation,
			authored: store(world, Rotation).value,
		},
		'scale.x': {
			computed: computed.scaleX,
			authored: store(world, Scale).x,
		},
		'scale.y': {
			computed: computed.scaleY,
			authored: store(world, Scale).y,
		},
		'scale': {
			computed: computed.scaleX,
			authored: store(world, UniformScale).value,
		},
		'skew.x': {
			computed: computed.skewX,
			authored: store(world, Skew).x,
		},
		'skew.y': {
			computed: computed.skewY,
			authored: store(world, Skew).y,
		},
		'width': {
			computed: computed.width,
			authored: store(world, Size).width,
		},
		'height': {
			computed: computed.height,
			authored: store(world, Size).height,
		},
		'opacity': {
			computed: computed.opacity,
			authored: store(world, Opacity).value,
		},
		'color': {
			computed: computed.color,
			authored: store(world, Color).value,
		},
		'blur': {
			computed: computed.blur,
			authored: store(world, Blur).value,
		},
		'volume': {
			computed: computed.volume,
			authored: store(world, Volume).value,
		},
		'effect.value': {
			computed: computed.value,
			authored: store(world, Effect).value,
		},
		'stroke.width': {
			computed: computed.strokeWidth,
			authored: store(world, StrokeStyle).width,
		},
		'vertexRadius': {
			computed: computed.cornerRadius,
			authored: store(world, CornerRadius).value,
		},
		'mixedVertexRadius.topLeft': {
			computed: computed.cornerRadiusTopLeft,
			authored: store(world, MixedCornerRadius).topLeft,
		},
		'mixedVertexRadius.topRight': {
			computed: computed.cornerRadiusTopRight,
			authored: store(world, MixedCornerRadius).topRight,
		},
		'mixedVertexRadius.bottomRight': {
			computed: computed.cornerRadiusBottomRight,
			authored: store(world, MixedCornerRadius).bottomRight,
		},
		'mixedVertexRadius.bottomLeft': {
			computed: computed.cornerRadiusBottomLeft,
			authored: store(world, MixedCornerRadius).bottomLeft,
		},
		'stop.offset': {
			computed: computed.stopOffset,
			authored: store(world, ColorStop).offset,
		},
		'chars': {
			computed: computed.chars,
			authored: store(world, Chars).value,
		},
	};
}

export type PropertyPath = keyof ReturnType<typeof getPropertyPaths>;

// ─── Easing ─────────────────────────────────────────────────

type EasingFunction = (t: number) => number;

const easingCache = new Map<string, EasingFunction>();

/**
 * Parse an easing descriptor string and return an easing function.
 * Returns null for empty/undefined (= default linear interpolation).
 * Supported formats:
 *   "steps(9)"  or "steps(9,true)"        → animejs steps(n, fromStart?)
 *   "cubicBezier(0.25,0.1,0.25,1)"       → animejs cubicBezier(x1,y1,x2,y2)
 *   "spring(0.5,500)"                     → animejs spring({ bounce, duration })
 */
function resolveEasing(descriptor: string | undefined): EasingFunction | null {
	if (!descriptor || descriptor === '') return null;

	const cached = easingCache.get(descriptor);
	if (cached) return cached;

	let fn: EasingFunction | null = null;

	const stepsMatch = descriptor.match(/^steps\((\d+)(?:,(true|false))?\)$/);
	if (stepsMatch) {
		const n = Number.parseInt(stepsMatch[1]!, 10);
		const fromStart = stepsMatch[2] === 'true';
		fn = steps(n, fromStart);
	}

	const bezierMatch = descriptor.match(/^cubicBezier\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)$/);
	if (bezierMatch) {
		const [, x1, y1, x2, y2] = bezierMatch;
		fn = cubicBezier(Number(x1), Number(y1), Number(x2), Number(y2));
	}

	const springMatch = descriptor.match(/^spring\(([\d.-]+),([\d.-]+)\)$/);
	if (springMatch) {
		const [, bounce, duration] = springMatch;
		const s = spring({
			bounce: Number(bounce),
			duration: Number(duration),
		});
		fn = (t: number) => s.ease(t);
	}

	if (fn) {
		easingCache.set(descriptor, fn);
		return fn;
	}

	return null;
}

/**
 * Sample a presorted aggregated keyframe track at a local frame.
 * Returns null only if the track has no keyframes.
 */
function sampleTrack(
	world: World,
	keyframes: Entity[],
	frame: number,
	property: PropertyPath,
): number | null {
	const keyframe = store(world, Keyframe);
	if (keyframes.length === 0) return null;

	if (keyframes.length === 1) {
		return keyframe.value[keyframes[0]!.id()]!;
	}

	const firstValue = keyframe.value[keyframes[0]!.id()]!;
	const lastValue = keyframe.value[keyframes[keyframes.length - 1]!.id()]!;

	const firstFrame = keyframe.time[keyframes[0]!.id()]!;
	const lastFrame = keyframe.time[keyframes[keyframes.length - 1]!.id()]!;

	if (frame <= firstFrame) {
		return firstValue;
	}

	if (frame >= lastFrame) {
		return lastValue;
	}

	for (let i = 0; i < keyframes.length - 1; i++) {
		const start = keyframe.time[keyframes[i]!.id()]!;
		const end = keyframe.time[keyframes[i + 1]!.id()]!;
		if (frame < start || frame > end) continue;

		const span = end - start;
		if (span <= 0) continue;

		let progress = Math.max(0, Math.min(1, (frame - start) / span));

		const easingFn = resolveEasing(keyframe.easing[keyframes[i]!.id()]);
		if (easingFn) {
			progress = easingFn(progress);
		}

		const startValue = keyframe.value[keyframes[i]!.id()]!;
		const endValue = keyframe.value[keyframes[i + 1]!.id()]!;

		if (property === 'color') {
			return lerpColor(startValue, endValue, progress);
		}

		// Linear interpolation
		return startValue + (endValue - startValue) * progress;
	}

	return lastValue;
}

/**
 * Channel-wise linear interpolation between two packed 0xRRGGBB colors.
 * Linear interpolation on the packed integer bleeds bits between channels
 * and produces wrong intermediate hues.
 */
function lerpColor(from: number, to: number, progress: number): number {
	const r0 = (from >> 16) & 0xFF;
	const g0 = (from >> 8) & 0xFF;
	const b0 = from & 0xFF;
	const r1 = (to >> 16) & 0xFF;
	const g1 = (to >> 8) & 0xFF;
	const b1 = to & 0xFF;
	const r = Math.round(r0 + (r1 - r0) * progress);
	const g = Math.round(g0 + (g1 - g0) * progress);
	const b = Math.round(b0 + (b1 - b0) * progress);
	return (r << 16) | (g << 8) | b;
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

/**
 * An amplitude multiplier (0-1) as the decibels to add to a volume. Silence
 * is -Infinity, which is what the audio bus reads as a gain of zero; every
 * other value is negative, so a ramp only ever attenuates.
 */
function amplitudeToDecibels(amplitude: number): number {
	return amplitude <= 0 ? -Infinity : 20 * Math.log10(amplitude);
}

function lerp(from: number, to: number, progress: number): number {
	return from + (to - from) * progress;
}
