/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { isProjectSource } from '@diffusionstudio/assets';
import { FrameRate, Library, Tool, ToolType, getSourceWindow, getVideoTrack } from '@diffusionstudio/runtime';
import { paintMask } from '@diffusionstudio/sam2/mask';
import { sam2ModelOfRepo } from '@diffusionstudio/sam2/models';
import { toast } from 'somoto';

import { getDocumentEditor } from '../editor';
import { commitObjectMask, encodeObjectMask } from './commit';
import { maskFrame } from './frame';
import { currentSourceFrame, getVideoRect } from './media';
import {
	clearObjectTrack, clearTargetEffect, finishMaskRestore, getMaskRestore, getObjectTrack, objectMaskModel, objectMaskModelLoad,
	setMaskRestore, setObjectHover, setObjectMaskModel, setObjectMaskModelLoad, setObjectTrack,
} from './store';

import type { Entity, World } from 'koota';
import type { InputVideoTrack } from 'mediabunny';
import type { Sam2Mask } from '@diffusionstudio/sam2/mask';
import type { Sam2Point, Sam2Video } from '@diffusionstudio/sam2';
import type { Sam2Model, Sam2ModelId } from '@diffusionstudio/sam2/models';
import type { AssetLibrary, MaskAsset, MaskFrame, VideoAsset } from '@diffusionstudio/assets';
import type { MaskPoint, MaskRestore, MaskStroke, ObjectMaskModelLoad, ObjectTrack } from './store';

// The model holds one object's memory and one held frame, so requests run
// one after another.
let queue: Promise<void> = Promise.resolve();
/** Whether a prompt or a track has the model; hovers wait for neither. */
let busy = false;

/** What every step needs: the model, the clip's decodable track, and where its frames are. */
type Session = {
	model: Sam2Video;
	video: InputVideoTrack;
	/** Where a project-rate source frame is in the file, in seconds. */
	seconds: (frame: number) => number;
	/** The footage's width over its height, which brush strokes are round in. */
	aspect: number;
};

/**
 * The frame the model holds encoded, by what it was decoded for — a clip, or
 * footage on its own (see `segmentFootage`) — and its source frame, so
 * prompts on it cost the decoder alone.
 */
let held: { owner: Entity | string; frame: number } | null = null;

/**
 * Prompts the object on `clip` with one more point and segments the current
 * frame. A point on the clip and frame the session was prompted on refines
 * that object, its brush strokes painted over the new segmentation; a point
 * anywhere else starts over there. Tracking through the clip waits for
 * `trackObjectMask`.
 */
export function promptObjectMask(world: World, clip: Entity, point: MaskPoint): void {
	const frame = currentSourceFrame(world, clip);
	const existing = getObjectTrack();
	const same = existing?.clip === clip && existing.seedFrame === frame;
	const points = same ? [...existing.points, point] : [point];

	const track: ObjectTrack = {
		clip,
		seedFrame: frame,
		points,
		strokes: same ? [...existing.strokes] : [],
		model: null,
		decoded: null,
		seedMask: null,
		first: frame,
		masks: [],
		status: 'loading',
		completed: 0,
		error: null,
		controller: new AbortController(),
	};
	setObjectTrack(track);
	setObjectHover(null);

	enqueue(world, track, async (session) => {
		track.status = 'segmenting';
		await holdFrame(session, clip, track.seedFrame);
		session.model.reset();
		const decoded = await session.model.seedHeld(track.points, 0);
		if (track.controller.signal.aborted) return;
		track.decoded = decoded;
		track.seedMask = paintMask(decoded, track.strokes, session.aspect);
		track.status = 'seeded';
	});
}

/**
 * Follows the prompted object through every source frame the clip plays,
 * then writes the frames into the library and authors the mask on the clip,
 * under an opacity effect (see `commitObjectMask`). The session is spent
 * once the document holds the mask: the clip is selected with the Move tool
 * so its effects, and the mask under them, are at hand.
 */
export function trackObjectMask(world: World): void {
	const seeded = getObjectTrack();
	if (!seeded || seeded.status !== 'seeded') return;

	const track: ObjectTrack = { ...seeded, controller: new AbortController(), status: 'loading', error: null };
	setObjectTrack(track);
	setObjectHover(null);

	enqueue(world, track, async (session) => {
		const { signal } = track.controller;
		const { trackObject } = await import('@diffusionstudio/sam2');

		// Every source frame of the clip, masked outward from the prompted one.
		const window = getSourceWindow(track.clip);
		const first = window.in;
		const count = Math.max(window.out - 1, first) - first + 1;
		const seedIndex = Math.min(Math.max(track.seedFrame - first, 0), count - 1);

		Object.assign(track, { first, masks: new Array<MaskFrame | null>(count).fill(null), completed: 0, status: 'tracking' });
		releaseFrame(session);
		session.model.reset();
		await trackObject(session.model, {
			track: session.video,
			timestamps: track.masks.map((_, i) => session.seconds(first + i)),
			seedIndex,
			points: track.points,
			correct: corrector(track.strokes, session.aspect),
			signal,
			onMask: (index, frameMask) => {
				track.masks[index] = maskFrame(frameMask);
				track.completed++;
			},
		});
		if (signal.aborted) return;

		track.status = 'saving';
		const mask = await commitObjectMask(world, track);
		if (signal.aborted) return;

		clearObjectTrack();
		clearTargetEffect();
		if (!mask) {
			toast.error('Object mask failed', { description: 'The mask could not be saved.' });
			return;
		}
		if (track.clip.isAlive()) getDocumentEditor(world).select(track.clip);
		if (world.get(Tool)?.value === ToolType.OBJECT_MASK) world.set(Tool, { value: ToolType.MOVE });
	});
}

/**
 * Puts the tool down without a mask: whatever the session was computing
 * stops, its prompt is dropped, and the Move tool takes over.
 */
export function cancelObjectMask(world: World): void {
	clearObjectTrack();
	clearTargetEffect();

	if (world.get(Tool)?.value === ToolType.OBJECT_MASK) {
		world.set(Tool, { value: ToolType.MOVE });
	}
}

// ── Hover ────────────────────────────────────────────────────

/** The latest point the pointer asked about while a preview was running; served next. */
let pendingHover: { clip: Entity; point: MaskPoint } | null = null;
let hovering = false;
let hoverEpoch = 0;

/**
 * Previews the segment a click at `point` on `clip` would pick, on the
 * current frame, kept hot in the model so only the mask decoder runs. On the
 * session's own clip and frame the hover refines its prompt. Requests
 * coalesce: while one runs the newest point waits, and the session's own
 * work (segmenting, tracking) takes precedence over hovering.
 */
export function hoverObjectMask(world: World, clip: Entity, point: MaskPoint): void {
	pendingHover = { clip, point };
	if (hovering || busy) return;
	hovering = true;

	queue = queue.then(async () => {
		try {
			while (pendingHover && !busy) {
				const { clip, point: at } = pendingHover;
				pendingHover = null;
				const epoch = hoverEpoch;
				if (!clip.isAlive()) continue;

				const track = getObjectTrack();
				if (track && track.status !== 'seeded' && track.status !== 'error') continue;

				const frame = currentSourceFrame(world, clip);
				const session = await openClipSession(world, clip);
				await holdFrame(session, clip, frame);
				// On the prompted frame the hover refines the prompt, elsewhere it starts one.
				const refining = track?.clip === clip && track.seedFrame === frame;
				const preview = refining
					? paintMask(await session.model.preview([...track.points, at]), track.strokes, session.aspect)
					: await session.model.preview([at]);
				if (epoch !== hoverEpoch) continue;
				setObjectHover({ clip, frame, point: at, mask: maskFrame(preview), size: preview.size });
			}
		} catch {
			// A hover is a hint; a failed one is nothing.
		} finally {
			hovering = false;
		}
	});
}

/** Forgets the hovered segment, when the pointer leaves the video. */
export function clearObjectHover(): void {
	hoverEpoch++;
	pendingHover = null;
	setObjectHover(null);
}

// ── Restore ──────────────────────────────────────────────────

/**
 * Whether `asset` is a mask that can be made again: it has its recipe, the
 * footage the recipe names is in the library, and its file lives in the
 * project, where the app may write.
 */
export function canRestoreObjectMask(library: AssetLibrary, asset: MaskAsset): boolean {
	const recipe = asset.recipe;
	return !!recipe && library.get(recipe.source)?.type === 'VIDEO' && isProjectSource(asset.source);
}

/**
 * Makes a mask's frames again from its recipe, for a mask whose file went
 * missing: the same footage, prompt and span, at the rate the file was
 * written at, tracked again — by the model that made them, or the tool's
 * when that one is no longer offered — and written back where the file was.
 * The library takes the file in again at the same path, so every `<mask>`
 * naming it shows it; should the new frames differ from the lost ones, the
 * new id is followed to them (see `onRelink`). The model's own sessions come first — a restore
 * waits its turn, and stops when another is asked for.
 */
export function restoreObjectMask(world: World, asset: MaskAsset): void {
	const library = world.get(Library);
	const recipe = asset.recipe;
	if (!library || !recipe || !canRestoreObjectMask(library, asset)) return;
	const video = library.get(recipe.source) as VideoAsset;

	const total = Math.max(1, Math.round(asset.duration * asset.frameRate));
	const restore: MaskRestore = {
		asset,
		status: 'loading',
		completed: 0,
		total,
		download: null,
		controller: new AbortController(),
	};
	setMaskRestore(restore);

	queue = queue.then(async () => {
		const { signal } = restore.controller;
		if (signal.aborted) return;

		busy = true;
		try {
			const model = sam2ModelOfRepo(recipe.model)?.id ?? objectMaskModel();
			const session = await openSession(video, asset.frameRate, model, (download) => (restore.download = download));
			if (signal.aborted) return;
			const { trackObject } = await import('@diffusionstudio/sam2');

			const masks = new Array<MaskFrame | null>(total).fill(null);
			restore.status = 'tracking';
			releaseFrame(session);
			session.model.reset();
			await trackObject(session.model, {
				track: session.video,
				timestamps: masks.map((_, i) => session.seconds(recipe.first + i)),
				seedIndex: Math.min(Math.max(recipe.seedFrame - recipe.first, 0), total - 1),
				points: recipe.points,
				correct: corrector(recipe.strokes ?? [], session.aspect),
				signal,
				onMask: (index, mask) => {
					masks[index] = maskFrame(mask);
					restore.completed++;
				},
			});
			if (signal.aborted) return;

			restore.status = 'saving';
			const file = encodeObjectMask(asset, asset.frameRate, session.model.maskSize, masks, { ...recipe, model: session.model.model.repo });
			await library.fs.write(asset.source, file);
			await library.relink(asset, asset.source);
		} catch (error) {
			if (signal.aborted) return;
			toast.error('Mask restore failed', { description: error instanceof Error ? error.message : String(error) });
		} finally {
			finishMaskRestore(restore);
			busy = false;
			// A restore by another model has replaced the tool's; it is loaded again.
			if (preloaded) preloadObjectMaskModel();
		}
	});
}

/** The restore of `asset` while it runs; null when there is none. */
export function getMaskRestoreOf(asset: MaskAsset | null | undefined): MaskRestore | null {
	const restore = getMaskRestore();
	return asset && restore?.asset.id === asset.id ? restore : null;
}

// ── Footage ──────────────────────────────────────────────────

/**
 * An object to segment in footage on its own, rather than on a clip: what
 * the agent's `media_segment` asks. Frames are counted on a grid of `fps`,
 * the one the mask file will hold.
 */
export type FootageSegmentRequest = {
	asset: VideoAsset;
	fps: number;
	model: Sam2ModelId;
	points: Sam2Point[];
	/** The frame the points are placed on. */
	seedFrame: number;
	/** The frames to mask, `count` from `first`, the seed among them; ignored by a preview. */
	first: number;
	count: number;
	/** Segments the seed frame alone, without tracking: the frame stays encoded, so the next prompt on it is quick. */
	preview: boolean;
	signal: AbortSignal;
	/** The model's download, 0 to 1, while it is on its way. */
	onDownload?: (progress: number | null) => void;
	/** Frames masked so far, of `count`. */
	onProgress?: (completed: number, total: number) => void;
};

export type FootageSegments = {
	model: Sam2Model;
	/** A frame per frame asked for, from `first` (the seed alone for a preview); null where none came. */
	masks: (MaskFrame | null)[];
	/** The side of the masks' grid. */
	grid: number;
	/** Where a frame of the grid is in the file, in seconds: where its mask was decoded. */
	seconds: (frame: number) => number;
};

/**
 * Segments an object in `request.asset` and follows it through the frames
 * asked for, or segments the prompted frame alone for a preview. It waits its
 * turn behind the tool's own sessions and holds the model while it runs, so
 * hovers wait too. Rejects with an `AbortError` when `signal` fires.
 */
export function segmentFootage(request: FootageSegmentRequest): Promise<FootageSegments> {
	const { asset, fps, points, seedFrame, first, count, signal } = request;
	return new Promise((resolve, reject) => {
		queue = queue.then(async () => {
			busy = true;
			try {
				signal.throwIfAborted();
				const session = await openSession(asset, fps, request.model, request.onDownload);
				signal.throwIfAborted();
				const model = session.model.model;
				const grid = session.model.maskSize;

				if (request.preview) {
					await holdFrame(session, `${asset.id}@${fps}`, seedFrame);
					const mask = await session.model.preview(points);
					resolve({ model, masks: [maskFrame(mask)], grid, seconds: session.seconds });
					return;
				}

				const { trackObject } = await import('@diffusionstudio/sam2');
				const masks = new Array<MaskFrame | null>(count).fill(null);
				let completed = 0;
				releaseFrame(session);
				session.model.reset();
				await trackObject(session.model, {
					track: session.video,
					timestamps: masks.map((_, i) => session.seconds(first + i)),
					seedIndex: seedFrame - first,
					points,
					signal,
					onMask: (index, mask) => {
						masks[index] = maskFrame(mask);
						request.onProgress?.(++completed, count);
					},
				});
				signal.throwIfAborted();
				resolve({ model, masks, grid, seconds: session.seconds });
			} catch (error) {
				reject(error);
			} finally {
				busy = false;
			}
		});
	});
}

// ── The model ────────────────────────────────────────────────────

/** Whether the tool has been opened, and so wants its model loaded. */
let preloaded = false;

/**
 * Loads the tool's model ahead of the first click, as the tool opens: the
 * download starts before the video is touched. Its progress, or what went
 * wrong, is on `objectMaskModelLoad`.
 */
export function preloadObjectMaskModel(): void {
	preloaded = true;
	loadModel(objectMaskModel()).catch(() => undefined);
}

/**
 * Switches the tool to model `id` and starts loading it; a model still
 * downloading is cancelled, and the files it fetched whole stay cached.
 */
export function pickObjectMaskModel(id: Sam2ModelId): void {
	setObjectMaskModel(id);
	preloadObjectMaskModel();
}

/**
 * Model `id`, loaded once and shared by whoever asks, with its load on
 * `objectMaskModelLoad`; `onDownload` hears its download, 0 to 1.
 */
async function loadModel(id: Sam2ModelId, onDownload?: (progress: number | null) => void): Promise<Sam2Video> {
	const current = objectMaskModelLoad();
	if (current?.id !== id || current.phase === 'error') {
		setObjectMaskModelLoad({ id, phase: 'download', progress: null, error: null });
	}
	// Another model asked for since takes the panel over.
	const update = (next: Omit<ObjectMaskModelLoad, 'id'>) => {
		if (objectMaskModelLoad()?.id === id) setObjectMaskModelLoad({ id, ...next });
	};

	try {
		const { loadSam2 } = await import('@diffusionstudio/sam2');
		const model = await loadSam2(id, {
			onProgress: (progress) => {
				const fraction = progress.phase === 'download' ? progress.loaded / progress.total : null;
				onDownload?.(fraction);
				// A percent at a time: the download reports every chunk.
				const shown = objectMaskModelLoad();
				if (fraction !== null && shown?.phase === 'download' && shown.progress !== null && Math.floor(shown.progress * 100) === Math.floor(fraction * 100)) return;
				update({ phase: progress.phase, progress: fraction, error: null });
			},
		});
		update({ phase: 'ready', progress: null, error: null });
		return model;
	} catch (error) {
		// A cancelled load gave way to another model, which has the panel now.
		if (!(error instanceof DOMException && error.name === 'AbortError')) {
			update({ phase: 'error', progress: null, error: error instanceof Error ? error.message : String(error) });
		}
		throw error;
	}
}

/** Runs `step` for `track` once the model is free, and files whatever goes wrong on the track. */
function enqueue(world: World, track: ObjectTrack, step: (session: Session) => Promise<void>): void {
	queue = queue.then(async () => {
		const { signal } = track.controller;
		if (signal.aborted) return;

		busy = true;
		try {
			const session = await openClipSession(world, track.clip);
			if (signal.aborted) return;
			track.model = session.model.model;
			await step(session);
		} catch (error) {
			if (signal.aborted) return;
			track.status = 'error';
			track.error = error instanceof Error ? error.message : String(error);
			toast.error('Object mask failed', { description: track.error });
		} finally {
			busy = false;
		}
	});
}

/** A session with the tool's model on the footage `clip` plays, at the project's rate. */
async function openClipSession(world: World, clip: Entity): Promise<Session> {
	const rect = getVideoRect(world, clip);
	if (!rect) throw new Error('The selection is not a video');
	const fps = world.get(FrameRate)?.value ?? 30;
	return openSession(rect.asset, fps, objectMaskModel());
}

/**
 * The model `id`, and `asset`'s footage on a grid of `fps` source frames.
 * Another model than the one loaded replaces it, and whatever it held.
 */
async function openSession(asset: VideoAsset, fps: number, id: Sam2ModelId, onDownload?: (progress: number | null) => void): Promise<Session> {
	const model = await loadModel(id, onDownload);

	const video = await getVideoTrack(asset);
	if (!video) throw new Error('The video could not be decoded');

	const firstTimestamp = await video.getFirstTimestamp();
	return {
		model,
		video,
		seconds: (frame) => sourceSeconds(frame, fps, asset, firstTimestamp),
		aspect: asset.width / asset.height,
	};
}

/** What has the model remember the seed's mask with `strokes` painted over it; none when there are none. */
function corrector(strokes: readonly MaskStroke[], aspect: number): ((mask: Sam2Mask) => Sam2Mask) | undefined {
	return strokes.length > 0 ? (mask) => paintMask(mask, strokes, aspect) : undefined;
}

/** Has the model hold `frame` of what `owner` plays, unless it already does. */
async function holdFrame(session: Session, owner: Entity | string, frame: number): Promise<void> {
	if (held && held.owner === owner && held.frame === frame && session.model.holding) return;
	const { holdFrame: hold } = await import('@diffusionstudio/sam2');
	await hold(session.model, { track: session.video, timestamp: session.seconds(frame) });
	held = { owner, frame };
}

function releaseFrame(session: Session): void {
	session.model.release();
	held = null;
}

/** Where a project-rate source frame is in the file, on the file's own frame grid, as the preview decoder seeks it. */
function sourceSeconds(frame: number, fps: number, asset: VideoAsset, firstTimestamp: number): number {
	return Math.round((frame / fps) * asset.frameRate) / asset.frameRate + firstTimestamp;
}

export { clearObjectTrack };
