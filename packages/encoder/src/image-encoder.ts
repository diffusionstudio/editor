/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	setActive, framesToSeconds, formatTimecode, assert, store, getEntityTree,
	assetSystem, playbackSystem, motionSystem, transformSystem, renderSystem,
	Muted, Workarea, Playback, Computed,
	Time, FrameRate, RenderSurface, AudioEngine,
} from '@diffusionstudio/runtime';

import { captureScene, normalizeSceneTransform, resolverSystem, warmupAssets } from './encoder';

import type { World } from '@diffusionstudio/koota';
import type { ImageEncoderConfig } from './interfaces';

/** One capture: the PNG plus the timecode of the frame rendered, e.g. `01s15f`. */
export type CapturedImage = { base64: string; timecode: string };

export type ImageExportResult =
	| { type: 'success'; data: CapturedImage[] }
	| { type: 'canceled' }
	| { type: 'error'; error: Error };

/**
 * Renders single frames of the scene a capture world holds into standalone
 * PNGs (base64, no data-url prefix).
 *
 * `world` is the caller's, built for this capture and holding the scene as
 * the stage's only child — the same arrangement `createEncoder` takes, and
 * for the same reason. A frame here is the frame an export would encode: the
 * canvas is the scene's own size, frame 0 is the workarea's first frame, and
 * the world is stepped the way an export steps it — the same systems, in the
 * same order, forward only. Seeking runs the project's own code, and a
 * DOM-backed node keeps what a seek did to it, so requested frames are
 * rendered in ascending order whatever order they were asked in, and never
 * measured or pre-rolled ahead of the first one drawn.
 */
export async function createImageEncoder(world: World, config: ImageEncoderConfig) {
	assert(config.frames.length > 0, 'No frames requested');

	const scene = captureScene(world);
	const sceneId = scene.id();

	const canvas = world.get(RenderSurface)?.canvas;
	assert(canvas instanceof HTMLCanvasElement, 'The capture world has no canvas to draw into');

	// Never started — image capture is video-only; the context is only there
	// for the lazy audio-bus wiring to have something to bind to.
	world.set(AudioEngine, { context: new OfflineAudioContext(2, 1, 48000) });

	// Mute everything so the playback system never initializes audio decoders.
	for (const entity of getEntityTree(world, scene)) {
		entity.add(Muted);
	}

	await warmupAssets(world);

	const computed = store(world, Computed);
	const playback = store(world, Playback);

	const frameRate = world.get(FrameRate)?.value ?? 30;
	const sceneWidth = computed.width[sceneId]!;
	const sceneHeight = computed.height[sceneId]!;
	const sceneEnd = computed.end[sceneId]!;

	// Frame 0 is the export's frame 0: the workarea's first frame.
	const workarea = scene.get(Workarea);
	const workareaStart = workarea ? Math.max(0, Math.min(sceneEnd, workarea.start)) : 0;
	const playheadStartSeconds = framesToSeconds(workareaStart, frameRate);

	setActive(world, scene);
	playback.playing[sceneId] = true;
	playback.loop[sceneId] = false;
	playback.speed[sceneId] = 1;

	// Ascending and deduplicated: the render loop only ever moves the world
	// forward, the way an export advances — never back.
	const order = [...new Set(config.frames)].sort((a, b) => a - b);

	/** Re-target the output height; callers that lay frames out do this once sized. */
	const resize = (height?: number) => {
		// The export's own scale and rounding, so a capture at a resolution is
		// pixel-for-pixel the encoded frame at that resolution.
		const scale = Math.round((height ?? sceneHeight) * 1e6 / sceneHeight) / 1e6;
		canvas.width = Math.round(sceneWidth * scale / 2) * 2;
		canvas.height = Math.round(sceneHeight * scale / 2) * 2;
		world.set(RenderSurface, { resolution: scale });
	};

	resize(config.resolution);

	let canceled = false;
	const cancel = () => (canceled = true);

	const render = async (): Promise<ImageExportResult> => {
		try {
			// Rendered in `order` and dealt back out in the requested order; a
			// frame asked for twice is drawn once.
			const images = new Map<number, CapturedImage>();

			const frameDuration = 1 / frameRate;

			for (const frame of order) {
				if (canceled) {
					return { type: 'canceled' };
				}

				const playheadSeconds = playheadStartSeconds + frame * frameDuration;

				// The export's tick, verbatim: the encoder owns the playhead and
				// writes both seconds + frames before each systems pass.
				computed.localTimeInSeconds[sceneId] = playheadSeconds;
				computed.localTime[sceneId] = Math.round(playheadSeconds * frameRate);
				const time = world.get(Time)!;
				world.set(Time, { delta: frameDuration * 1000, now: time.now + frameDuration * 1000 });

				assetSystem(world);
				playbackSystem(world);
				await resolverSystem(world);
				motionSystem(world);
				// May be changed by a system
				normalizeSceneTransform(world, sceneId);
				transformSystem(world);
				renderSystem(world);

				images.set(frame, {
					base64: await toBase64Png(canvas),
					timecode: formatTimecode(playheadSeconds, frameRate),
				});
			}

			return { type: 'success', data: config.frames.map((frame) => images.get(frame)!) };
		} catch (e) {
			return {
				type: 'error',
				error: e instanceof Error ? e : new Error('Unknown error'),
			};
		}
		// The world, its canvas and its decoders are the caller's to release.
	};

	return {
		render,
		cancel,
		resize,
		bounds: { width: sceneWidth, height: sceneHeight },
	};
}

async function toBase64Png(canvas: HTMLCanvasElement): Promise<string> {
	const blob = await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not encode PNG')), 'image/png');
	});
	const dataUrl = await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
	return dataUrl.split(',')[1] ?? '';
}
