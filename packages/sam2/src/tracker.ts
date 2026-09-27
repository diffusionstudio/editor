/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { BYTES_PER_FLOAT, HIDDEN_DIM, MAX_POINTERS, MEM_DIM, geometryOf } from './constants';
import { FramePreprocessor, TokenTransposer, createStorageBuffer } from './gpu';
import { MemoryBank } from './memory';
import { GIVEN_LOGIT, clearMask, maskIsEmpty, packMask } from './mask';
import { disposeOutputs, floatTensor, floats, gpuBuffer, gpuTensor, intTensor } from './sessions';

import type { ModelConstants, Sam2Geometry, Sam2Model } from './constants';
import type { Rotation } from './gpu';
import type { Sam2Mask } from './mask';
import type { Outputs, Session, Tensor } from './sessions';

/** A prompt on the displayed frame, in 0..1 of its width and height; label 1 is the object, 0 is background. */
export type Sam2Point = { x: number; y: number; label: 0 | 1 };

/**
 * The prompted frame's mask as the user corrected it, from the model's own:
 * what the frame is remembered as, and so what every tracked frame follows.
 * Returning the mask it was given leaves the model's.
 */
export type Sam2Correction = (mask: Sam2Mask) => Sam2Mask;

export type Sam2Sessions = {
	visionEncoder: Session;
	maskDecoder: Session;
	memoryEncoder: Session;
	memoryAttention: Session;
	pointerTpos: Session;
};

type Prompt = { points: Tensor; labels: Tensor };

type SegmentedFrame = { index: number; prompted: boolean; correct?: Sam2Correction };

/**
 * SAM 2.1 video tracking over one object. `seed` segments it on the prompted
 * frame; `track` follows it through the frames that come after, each one
 * conditioned on the memory of those before. Frames are numbered by the
 * caller, and their distances are what the model's temporal encodings read.
 */
export class Sam2Video {
	readonly geometry: Sam2Geometry;
	private readonly preprocessor: FramePreprocessor;
	private readonly transposer: TokenTransposer;
	private readonly bank: MemoryBank;
	private readonly featureTokens: GPUBuffer;
	private readonly positionTokens: GPUBuffer;
	/** The frame kept encoded for `preview` and `seedHeld`, so a prompt costs the decoder alone. */
	private held: Outputs | null = null;

	/** `positions` is the vision encoder's `pos_embed`, [HIDDEN_DIM, featTokens]. */
	constructor(
		readonly model: Sam2Model,
		device: GPUDevice,
		private readonly sessions: Sam2Sessions,
		constants: ModelConstants,
		positions: Float32Array,
	) {
		const geometry = (this.geometry = geometryOf(model.imageSize));
		this.preprocessor = new FramePreprocessor(device, geometry.imageSize, constants.image_mean, constants.image_std);
		this.transposer = new TokenTransposer(device, geometry);
		this.bank = new MemoryBank(device, geometry, constants.memory_temporal_positional_encoding);
		this.featureTokens = createStorageBuffer(device, geometry.featTokens * HIDDEN_DIM * BYTES_PER_FLOAT, 'sam2 vision tokens');
		this.positionTokens = createStorageBuffer(device, geometry.featTokens * HIDDEN_DIM * BYTES_PER_FLOAT, 'sam2 position tokens');
		device.queue.writeBuffer(this.positionTokens, 0, toTokens(positions, geometry.featTokens));
	}

	/** The side of its masks' grid. */
	get maskSize(): number {
		return this.geometry.maskSize;
	}

	/**
	 * Segments the object at `points` and makes this the frame every later one
	 * is tracked from, as `correct` has it when given.
	 */
	async seed(frame: VideoFrame, rotation: Rotation, points: Sam2Point[], index: number, correct?: Sam2Correction): Promise<Sam2Mask> {
		const vision = await this.encode(frame, rotation);
		try {
			return await this.segment(vision, vision.feats2_no_mem!, this.pointPrompt(points), { index, prompted: true, correct });
		} finally {
			disposeOutputs(vision);
		}
	}

	/**
	 * Encodes a frame and keeps it hot: `preview` and `seedHeld` then run
	 * the mask decoder alone, which is what makes prompting feel immediate.
	 * It stays held until another frame is encoded, by this or `seed` or `track`.
	 */
	async hold(frame: VideoFrame, rotation: Rotation): Promise<void> {
		this.held = await this.encode(frame, rotation);
	}

	get holding(): boolean {
		return this.held !== null;
	}

	/** Drops the held frame. */
	release(): void {
		if (this.held) disposeOutputs(this.held);
		this.held = null;
	}

	/** Segments the held frame at `points` without remembering it: what a click there would pick. */
	async preview(points: Sam2Point[]): Promise<Sam2Mask> {
		const vision = this.heldFrame();
		const prompt = this.pointPrompt(points);
		const decoded = await this.sessions.maskDecoder.run({
			feats0: vision.feats0!,
			feats1: vision.feats1!,
			feats2_cond: vision.feats2_no_mem!,
			input_points: prompt.points,
			input_labels: prompt.labels,
		});
		try {
			return this.unpack(decoded);
		} finally {
			disposeOutputs(decoded);
		}
	}

	/** `seed` on the held frame. */
	seedHeld(points: Sam2Point[], index: number, correct?: Sam2Correction): Promise<Sam2Mask> {
		const vision = this.heldFrame();
		return this.segment(vision, vision.feats2_no_mem!, this.pointPrompt(points), { index, prompted: true, correct });
	}

	private heldFrame(): Outputs {
		if (!this.held) throw new Error('No frame is held');
		return this.held;
	}

	/** Finds the seeded object in a frame `index` steps along from the last one. */
	async track(frame: VideoFrame, rotation: Rotation, index: number, totalFrames: number): Promise<Sam2Mask> {
		const vision = await this.encode(frame, rotation);
		try {
			this.transposer.run(gpuBuffer(vision, 'feats2'), this.featureTokens);

			const distances = this.bank.assemble(index, totalFrames);
			const temporal = await this.sessions.pointerTpos.run({ normalized_diffs: floatTensor(distances, [MAX_POINTERS]) });
			this.bank.setPointerPositions(gpuBuffer(temporal, 'pointer_pos'));
			disposeOutputs(temporal);

			const { featTokens, memoryRows } = this.geometry;
			const attended = await this.sessions.memoryAttention.run({
				current_vision_features: gpuTensor(this.featureTokens, [featTokens, 1, HIDDEN_DIM]),
				current_vision_position_embeddings: gpuTensor(this.positionTokens, [featTokens, 1, HIDDEN_DIM]),
				memory: gpuTensor(this.bank.memory, [memoryRows, 1, MEM_DIM]),
				memory_pos: gpuTensor(this.bank.memoryPos, [memoryRows, 1, MEM_DIM]),
			});
			try {
				return await this.segment(vision, attended.conditioned_feats!, paddingPrompt(), { index, prompted: false });
			} finally {
				disposeOutputs(attended);
			}
		} finally {
			disposeOutputs(vision);
		}
	}

	/** Forgets the tracked frames but not the seed, to track away from it in the other direction. */
	rewind(): void {
		this.bank.rewind();
	}

	reset(): void {
		this.bank.reset();
	}

	dispose(): void {
		this.release();
		this.bank.dispose();
		this.preprocessor.dispose();
		this.featureTokens.destroy();
		this.positionTokens.destroy();
		for (const session of Object.values(this.sessions)) void session.release();
	}

	/** The encoder is captured, so its outputs are one set of buffers: encoding a frame overwrites the one held. */
	private async encode(frame: VideoFrame, rotation: Rotation): Promise<Outputs> {
		this.release();
		this.preprocessor.run(frame, rotation);
		const size = this.geometry.imageSize;
		return this.sessions.visionEncoder.run(
			{ pixel_values: gpuTensor(this.preprocessor.pixels, [1, 3, size, size]) },
			VISION_OUTPUTS,
		);
	}

	/**
	 * Decodes the mask, then encodes the frame into memory as the prompted
	 * frame or the next tracked one. A tracked frame the model is unsure of is
	 * not remembered: a wrong guess kept in memory is what the next frames
	 * would match, so it would be reinforced rather than corrected.
	 */
	private async segment(vision: Outputs, conditioned: Tensor, prompt: Prompt, frame: SegmentedFrame): Promise<Sam2Mask> {
		const decoded = await this.sessions.maskDecoder.run({
			feats0: vision.feats0!,
			feats1: vision.feats1!,
			feats2_cond: conditioned,
			input_points: prompt.points,
			input_labels: prompt.labels,
		});
		try {
			const mask = this.unpack(decoded);
			if (frame.prompted) {
				const corrected = frame.correct?.(mask) ?? mask;
				if (corrected === mask) {
					await this.remember(vision, decoded, frame.index, true);
					return mask;
				}
				// As SAM 2 takes a mask prompt: the object is there exactly where the mask says.
				const given = { ...corrected, score: maskIsEmpty(corrected) ? -GIVEN_LOGIT : GIVEN_LOGIT };
				await this.remember(vision, decoded, frame.index, true, given);
				return given;
			}

			if (isReliable(mask)) await this.remember(vision, decoded, frame.index, false);
			return isPlausible(mask) ? mask : clearMask(mask);
		} finally {
			disposeOutputs(decoded);
		}
	}

	/**
	 * Encodes the frame's mask into memory, as the prompted frame or the next
	 * tracked one: the decoder's, or `given` in its place. A given mask keeps
	 * the decoder's object pointer, which the points it was corrected from made.
	 */
	private async remember(vision: Outputs, decoded: Outputs, index: number, prompted: boolean, given?: Sam2Mask): Promise<void> {
		const size = this.geometry.imageSize;
		const memory = await this.sessions.memoryEncoder.run({
			feats2: vision.feats2!,
			high_res_mask: given ? floatTensor(maskLogits(given, size), [1, 1, size, size]) : decoded.high_res_mask!,
			object_score_logits: floatTensor(given ? [given.score] : floats(decoded, 'object_score_logits'), [1, 1]),
			binarize: floatTensor([prompted ? 1 : 0], []),
		});
		try {
			if (!this.bank.hasPositions) {
				this.bank.setPositions((await memory.memory_pos!.getData()) as Float32Array);
			}

			const tokens = gpuBuffer(memory, 'memory_tokens');
			const pointer = gpuBuffer(decoded, 'object_pointer');
			if (prompted) this.bank.condition(index, tokens, pointer);
			else this.bank.push(index, tokens, pointer);
		} finally {
			disposeOutputs(memory);
		}
	}

	private unpack(decoded: Outputs): Sam2Mask {
		return packMask(floats(decoded, 'low_res_mask'), this.geometry.maskSize, floats(decoded, 'object_score_logits')[0]!, floats(decoded, 'iou')[0]!);
	}

	private pointPrompt(points: Sam2Point[]): Prompt {
		if (points.length === 0) throw new Error('A prompt needs at least one point');
		const size = this.geometry.imageSize;
		return {
			points: floatTensor(points.flatMap((point) => [point.x * size, point.y * size]), [1, 1, points.length, 2]),
			labels: intTensor(points.map((point) => point.label), [1, 1, points.length]),
		};
	}
}

/**
 * What the pipeline reads of the vision encoder. Its `vision_pos_embed` is a
 * constant the runtime folds away, and a captured graph does not write folded
 * outputs; `positionTokens` holds it instead, read from the model's weights.
 */
const VISION_OUTPUTS = ['feats0', 'feats1', 'feats2', 'feats2_no_mem'];

/** Rewrites [C, N] channels as the [N, 1, C] tokens memory attention reads. */
function toTokens(channels: Float32Array, count: number): Float32Array<ArrayBuffer> {
	const tokens = new Float32Array(channels.length);
	for (let c = 0; c < HIDDEN_DIM; c++) {
		for (let n = 0; n < count; n++) tokens[n * HIDDEN_DIM + c] = channels[c * count + n]!;
	}
	return tokens;
}

/**
 * Tracked frames enter memory only when the model sees the object and trusts
 * its mask, as SAMURAI selects them. Around a cut or a lookalike the
 * predicted IoU collapses while the object score can stay just above zero;
 * when the object turns or changes shape it only sags, and those frames must
 * still be remembered for the tracker to follow the new appearance.
 */
const RELIABLE_IOU = 0.25;

/**
 * Below this predicted IoU a tracked mask is reported as empty whatever the
 * object score: on the test footage only masks of the wrong object, just after
 * a cut, came out this low.
 */
const PLAUSIBLE_IOU = 0.15;

/**
 * A mask's logits as the decoder's `high_res_mask`: upsampled to the
 * image as the decoder upsamples its own, bilinear with cell centers aligned.
 * A prompted frame's memory is made from where they are above zero.
 */
function maskLogits(mask: Sam2Mask, imageSize: number): Float32Array {
	// Each image row or column reads two cells, at a weight for the second.
	const scale = mask.size / imageSize;
	const lower = new Int32Array(imageSize);
	const upper = new Int32Array(imageSize);
	const weight = new Float32Array(imageSize);
	for (let o = 0; o < imageSize; o++) {
		const source = Math.max(0, (o + 0.5) * scale - 0.5);
		lower[o] = Math.floor(source);
		upper[o] = Math.min(lower[o]! + 1, mask.size - 1);
		weight[o] = source - lower[o]!;
	}

	const at = (x: number, y: number) => mask.logits[y * mask.size + x]!;
	const logits = new Float32Array(imageSize * imageSize);
	for (let y = 0; y < imageSize; y++) {
		const y0 = lower[y]!;
		const y1 = upper[y]!;
		const wy = weight[y]!;
		for (let x = 0; x < imageSize; x++) {
			const x0 = lower[x]!;
			const x1 = upper[x]!;
			const wx = weight[x]!;
			const top = at(x0, y0) * (1 - wx) + at(x1, y0) * wx;
			const bottom = at(x0, y1) * (1 - wx) + at(x1, y1) * wx;
			logits[y * imageSize + x] = top * (1 - wy) + bottom * wy;
		}
	}
	return logits;
}

function isReliable(mask: Sam2Mask): boolean {
	return mask.score > 0 && mask.iou >= RELIABLE_IOU;
}

function isPlausible(mask: Sam2Mask): boolean {
	return mask.iou >= PLAUSIBLE_IOU;
}

/** What the decoder is prompted with on frames that have no points of their own. */
function paddingPrompt(): Prompt {
	return { points: floatTensor([0, 0], [1, 1, 1, 2]), labels: intTensor([-1], [1, 1, 1]) };
}
