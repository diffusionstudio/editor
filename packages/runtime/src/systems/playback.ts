/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Playback system (was systems/playback.ts): advances root playheads, derives
// per-entity local time + visibility, forwards decoders/hosts, keeps the
// audio bus tree in sync, and steps live mounts. In offline modes the encoder
// sets the playhead explicitly and awaits FramePromises.

import { Not, Or } from '@diffusionstudio/koota';

import { store } from '../world/store';
import { PaintType } from '../constants';
import {
	ChildOf, Hidden, Culled, Dragging,
	Geometry, Group, AdjustmentLayer, Paint, Audio, Caption, Muted, Soloed,
	Sequential, Transition, Playback, Workarea,
	AudioPlayback, Computed,
	AudioDecoderHandle, AudioBusHandle, Host,
	Mode, FrameRate, Time, AudioEngine, FramePromises, Tickers,
	Root,
} from '../traits';
import { getParentNode } from '../queries/hierarchy';
import { getIntrinsicPaint, getSourceWindow } from '../utils/time';
import { clamp } from '../math/common';
import { getTransitionWindow } from '../utils/transition';
import {
	resolveAudioDecoder, resolveCaptionDecoder, resolveImageDecoder,
	resolveShaderHost, resolveVideoDecoder,
} from '../media';
import { whenHtmlReady } from '../media/html';
import { AudioBus } from '../media/audio-bus';

import type { Entity, World } from '@diffusionstudio/koota';

const WARMUP_FRAMES = 15;

function framePromises(world: World) {
	return world.get(FramePromises)?.list ?? null;
}

function advancePlayhead(world: World, entity: Entity): void {
	// In offline mode the encoder sets the playhead explicitly per frame, so
	// skip the delta-based advance — running it would either double-step or
	// drift depending on how the caller set `Time.delta`.
	if (world.get(Mode)?.value !== 'realtime') return;

	const playback = store(world, Playback);
	const computed = store(world, Computed);
	const eid = entity.id();
	const fps = world.get(FrameRate)?.value ?? 30;
	let looped = false;

	// Only advance the playhead while playing. The audio play/stop bookkeeping
	// below must still run when stopped, otherwise a manual stop (playing
	// flipped off externally) is never observed — `wasPlaying` stays stuck and
	// the next play isn't re-anchored, so scheduled buffers land in the past
	// and play silently.
	if (playback.playing[eid] === true) {
		const dt = (world.get(Time)?.delta ?? 0) / 1000;
		const speed = playback.speed[eid] || 1;
		const previousTime = computed.localTimeInSeconds[eid]!;
		let time = previousTime + dt * speed;

		const hasWorkarea = entity.has(Workarea);
		const workarea = store(world, Workarea);
		const duration = computed.duration[eid]!;
		const durationSeconds = duration / fps;

		const maxSeconds = hasWorkarea
			? (workarea.end[eid] ?? duration) / fps
			: durationSeconds;

		const minSeconds = hasWorkarea
			? (workarea.start[eid] ?? 0) / fps
			: 0;

		if (time >= maxSeconds) {
			if (playback.loop[eid] === true) {
				time = minSeconds;
				looped = true;
			} else {
				playback.playing[eid] = false;
			}
		} else if (time <= minSeconds) {
			if (playback.loop[eid] === true) {
				time = maxSeconds;
				looped = true;
			} else {
				playback.playing[eid] = false;
				time = minSeconds;
			}
		}

		computed.localTimeInSeconds[eid] = clamp(time, minSeconds, maxSeconds);
		computed.localTime[eid] = Math.round(computed.localTimeInSeconds[eid]! * fps);
	}

	// Handle audio play/stop transitions
	if (!entity.has(AudioPlayback)) entity.add(AudioPlayback);
	const audioPlayback = store(world, AudioPlayback);
	const ctx = world.get(AudioEngine)?.context;
	const playing = playback.playing[eid] ?? false;
	const wasPlaying = audioPlayback.wasPlaying[eid] ?? false;

	if ((playing && !wasPlaying) || looped) {
		audioPlayback.contextOffsetInSeconds[eid] = ctx?.currentTime ?? 0;
		audioPlayback.timelineOffsetInSeconds[eid] = computed.localTimeInSeconds[eid]!;
	}

	if (!playing && wasPlaying) {
		resetDecoders(world, entity);
	}

	audioPlayback.wasPlaying[eid] = playing;
}

function forwardVideoDecoder(world: World, scene: Entity, entity: Entity, fill: Entity): void {
	const computed = store(world, Computed);
	const eid = entity.id();
	const fps = world.get(FrameRate)?.value ?? 30;

	const globalFrame = computed.localTime[scene.id()]!;
	const localFrame = computed.localTime[eid]!;
	const start = computed.start[eid]!;
	const end = computed.end[eid]!;
	const hasCache = world.get(Mode)?.value === 'realtime';
	const warmupDecoder = globalFrame >= start - WARMUP_FRAMES && globalFrame < end + WARMUP_FRAMES && hasCache;

	const source = getSourceWindow(entity);

	const decoder = resolveVideoDecoder(world, fill);
	if (!decoder) return;

	if (computed.visibility[eid] === 1 || warmupDecoder) {
		const seekFrame = clamp(localFrame, source.in, source.out);
		const seekPromise = decoder.seekTo(seekFrame, fps);
		framePromises(world)?.push(seekPromise ?? null);
	}
}

function forwardCaptionDecoder(world: World, _scene: Entity, entity: Entity): void {
	const localFrame = store(world, Computed).localTime[entity.id()]!;
	const fps = world.get(FrameRate)?.value ?? 30;

	const decoder = resolveCaptionDecoder(world, entity);
	decoder?.seekTo(world, entity, localFrame / fps);
}

/**
 * Forward the audio decoder for a child entity. `audioSource` optionally
 * points at the sub-entity carrying the audio (a video fill), while the
 * timing still comes from the clip entity itself.
 */
function forwardAudioDecoder(world: World, scene: Entity, entity: Entity, audioSource?: Entity): void {
	if (entity.has(Muted)) return;

	const resolvedDecoder = resolveAudioDecoder(world, audioSource ?? entity);
	if (!resolvedDecoder) return;

	const { decoder, initPromise } = resolvedDecoder;

	const computed = store(world, Computed);
	const audioPlayback = store(world, AudioPlayback);
	const playback = store(world, Playback);
	const eid = entity.id();
	const sid = scene.id();
	const fps = world.get(FrameRate)?.value ?? 30;

	const currentTime = computed.localTime[sid]!;
	const localFrame = computed.localTime[eid]!;
	const source = getSourceWindow(entity);

	const playbackRate = computed.playbackRate[eid] || 1;
	const origin = computed.origin[eid]!;

	const audioOffset = audioPlayback.contextOffsetInSeconds[sid] ?? 0;
	const playbackOffset = audioPlayback.timelineOffsetInSeconds[sid] ?? 0;
	// In offline rendering the encoder pins contextOffset to 0 and playbackOffset
	// to the workarea start, so this term shifts scheduled audio back into the
	// encoded window (and resolves to 0 when there is no workarea).
	const audioDelay = audioOffset - playbackOffset;
	const bus = resolveAudioBus(world, entity);

	if (!decoder.ready) {
		framePromises(world)?.push(initPromise);
	} else if (computed.visibility[eid] === 1 && playback.playing[sid] === true) {
		const playPromise = decoder.playTo(bus, {
			relativeFrom: localFrame / fps,
			relativeTo: (localFrame + 15) / fps,
			trimStart: source.in / fps,
			trimEnd: source.out / fps,
			playbackRate,
			currentTime: currentTime / fps,
			relativeDelay: (origin / fps) + audioDelay,
		});
		framePromises(world)?.push(playPromise);
	} else {
		decoder.reset();
	}
}

function forwardHtmlHost(world: World, scene: Entity, entity: Entity, fill: Entity): void {
	const computed = store(world, Computed);
	const root = fill.get(Host)?.element;
	if (world.get(Mode)?.value === 'realtime'
		|| computed.visibility[entity.id()] !== 1
		|| !(root instanceof HTMLElement)) return;
	framePromises(world)?.push(whenHtmlReady(root, computed.localTimeInSeconds[scene.id()] ?? 0));
}

function forwardImageDecoder(world: World, _scene: Entity, _entity: Entity, fill: Entity): void {
	const resolvedDecoder = resolveImageDecoder(world, fill);
	if (!resolvedDecoder) return;

	const { decoder, initPromise } = resolvedDecoder;

	if (!decoder.ready) {
		framePromises(world)?.push(initPromise);
	}
}

/**
 * Forward decoders for a child entity and its node descendants.
 */
function forwardDecoders(world: World, scene: Entity, entity: Entity): void {
	const paintStore = store(world, Paint);

	const hidden = entity.has(Hidden) || entity.has(Culled);
	const visualsEnabled = !hidden && world.get(Mode)?.value !== 'offline-audio';

	let intrinsicVideo = false;
	let paintAudioSource: Entity | undefined;

	if (!hidden) {
		const intrinsic = getIntrinsicPaint(entity);
		if (intrinsic === PaintType.VIDEO) {
			if (visualsEnabled) {
				forwardVideoDecoder(world, scene, entity, entity);
			}
			intrinsicVideo = true;
		} else if (intrinsic === PaintType.IMAGE && visualsEnabled) {
			forwardImageDecoder(world, scene, entity, entity);
		} else if (intrinsic === PaintType.HTML && visualsEnabled) {
			forwardHtmlHost(world, scene, entity, entity);
		}

		for (const fill of world.query(ChildOf(entity), Paint, Not(Geometry), Not(Hidden))) {
			const paint = paintStore.value[fill.id()];

			if (paint === PaintType.VIDEO) {
				if (visualsEnabled) {
					forwardVideoDecoder(world, scene, entity, fill);
				}
				paintAudioSource = fill;
			}

			if (paint === PaintType.IMAGE && visualsEnabled) {
				forwardImageDecoder(world, scene, entity, fill);
			}

			if (paint === PaintType.HTML && visualsEnabled) {
				forwardHtmlHost(world, scene, entity, fill);
			}

			if (paint === PaintType.SHADER && visualsEnabled) {
				const ready = resolveShaderHost(world, fill)?.whenReady();
				if (ready) framePromises(world)?.push(ready);
			}
		}
	}

	if (entity.has(Caption) && visualsEnabled) {
		forwardCaptionDecoder(world, scene, entity);
	}

	if (intrinsicVideo || entity.has(Audio) || paintAudioSource) {
		forwardAudioDecoder(world, scene, entity, paintAudioSource);
	}

	for (const child of world.query(ChildOf(entity), Or(Geometry, Group, AdjustmentLayer), Not(Hidden))) {
		forwardDecoders(world, scene, child);
	}
}

function updateVisibility(world: World, scene: Entity, entity: Entity): void {
	const computed = store(world, Computed);
	const eid = entity.id();

	// Root or dragging entity is always visible
	if (entity === scene || entity.has(Dragging)) {
		computed.visibility[eid] = 1;
	} else {
		const globalFrame = computed.localTime[scene.id()]!;
		const origin = computed.origin[eid] ?? 0;
		const playbackRate = computed.playbackRate[eid] || 1;

		const start = computed.start[eid]!;
		const end = computed.end[eid]!;

		computed.localTime[eid] = Math.round((globalFrame - origin) * playbackRate);
		computed.visibility[eid] = globalFrame >= start && globalFrame < end ? 1 : 0;
	}

	for (const child of world.query(Or(Geometry, Group, AdjustmentLayer), ChildOf(entity))) {
		updateVisibility(world, scene, child);
	}
}

function resetDecoders(world: World, entity: Entity): void {
	if (entity.has(AudioDecoderHandle)) {
		entity.get(AudioDecoderHandle)?.reset();
	}

	for (const child of world.query(ChildOf(entity), AudioDecoderHandle)) {
		resetDecoders(world, child);
	}
}


function collectAncestors(entity: Entity): Entity[] {
	const path: Entity[] = [];

	let current: Entity | null = entity;
	while (current) {
		path.push(current);
		current = getParentNode(current);
	}

	return path.toReversed();
}

/**
 * The entity's audio bus, building (and wiring) the ancestor bus chain on
 * first use. Null when the world has no audio context.
 */
export function resolveAudioBus(world: World, entity: Entity): AudioBus | null {
	const existing = entity.has(AudioBusHandle) ? entity.get(AudioBusHandle) : null;
	if (existing) return existing;

	const context = world.get(AudioEngine)?.context;
	if (!context) return null;

	const ancestors = collectAncestors(entity);

	// Walk root -> leaf, connecting each bus's gain into its parent's input
	// (root connects into the context destination). Reuse buses that already
	// exist; only newly created ones need wiring.
	let currentInput: AudioNode = context.destination;

	for (const ancestor of ancestors) {
		let bus = ancestor.has(AudioBusHandle) ? ancestor.get(AudioBusHandle) : null;

		if (!bus) {
			bus = new AudioBus(world, ancestor);
			ancestor.add(AudioBusHandle);
			ancestor.set(AudioBusHandle, bus);
			bus.connect(currentInput);
		}

		currentInput = bus.input;
	}

	return entity.get(AudioBusHandle) ?? null;
}

function getGlobalFrame(world: World, entity: Entity): number {
	const computed = store(world, Computed);

	let current: Entity | null = entity;
	while (current) {
		if (current.has(Playback)) {
			return computed.localTime[current.id()]!;
		}
		current = getParentNode(current);
	}

	return 0;
}

export function playbackSystem(world: World): void {
	const computed = store(world, Computed);

	// handle root playback
	for (const entity of world.query(Playback)) {
		advancePlayhead(world, entity);
	}

	for (const entity of world.query(Or(Geometry, Group, AdjustmentLayer), ChildOf(world.get(Root)!))) {
		updateVisibility(world, entity, entity);
		forwardDecoders(world, entity, entity);
	}

	// handle transition visibility
	for (const clip of world.query(Or(Geometry, Group, AdjustmentLayer), Transition)) {
		const parent = getParentNode(clip);

		if (parent == null || !parent.has(Sequential)) {
			console.info('Removing transition due to non-sequential parent', clip);
			// System-driven cleanup of orphaned state — not a user edit.
			clip.remove(Transition);
			continue;
		}

		const children = world.query(ChildOf(parent), Or(Geometry, Group, AdjustmentLayer));
		const partner = children.find(sibling => computed.start[sibling.id()] === computed.end[clip.id()]);
		if (!partner) continue;
		const window = getTransitionWindow(world, clip, partner);
		const globalFrame = getGlobalFrame(world, clip);
		if (globalFrame >= window.start && globalFrame < window.end) {
			computed.visibility[clip.id()] = 1;
			computed.visibility[partner.id()] = 1;
		}
	}

	// Sync audio buses
	let soloed: Set<Entity> | null = null;
	for (const entity of world.query(AudioBusHandle)) {
		entity.get(AudioBusHandle)?.sync();
		if (!entity.has(Soloed)) continue;

		if (soloed === null) {
			soloed = new Set();
		}

		for (const ancestor of collectAncestors(entity)) {
			soloed.add(ancestor);
		}
	}

	if (soloed) {
		for (const entity of world.query(AudioBusHandle)) {
			if (!soloed.has(entity)) {
				entity.get(AudioBusHandle)?.mute();
			}
		}
	}

	for (const tick of world.get(Tickers) ?? []) tick();
}
