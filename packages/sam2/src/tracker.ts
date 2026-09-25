/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	BYTES_PER_FLOAT, FEAT_TOKENS, HIDDEN_DIM, IMAGE_SIZE, MAX_POINTERS, MEM_DIM, MEMORY_ROWS,
} from './constants';
import { FramePreprocessor, TokenTransposer, createStorageBuffer } from './gpu';
import { MemoryBank } from './memory';
import { packMask } from './mask';
import { disposeOutputs, floatTensor, floats, gpuBuffer, gpuTensor, intTensor } from './sessions';

import type { ModelConstants } from './constants';
import type { Rotation } from './gpu';
import type { Sam2Mask } from './mask';
import type { Outputs, Session, Tensor } from './sessions';

/** A prompt on the displayed frame, in 0..1 of its width and height; label 1 is the object, 0 is background. */
export type Sam2Point = { x: number; y: number; label: 0 | 1 };

export type Sam2Sessions = {
	visionEncoder: Session;
	maskDecoder: Session;
	memoryEncoder: Session;
	memoryAttention: Session;
	pointerTpos: Session;
};

type Prompt = { points: Tensor; labels: Tensor };

/**
 * SAM 2.1 video tracking over one object. `seed` segments it on the prompted
 * frame; `track` follows it through the frames that come after, each one
 * conditioned on the memory of those before. Frames are numbered by the
 * caller, and their distances are what the model's temporal encodings read.
 */
export class Sam2Video {
	private readonly preprocessor: FramePreprocessor;
	private readonly transposer: TokenTransposer;
	private readonly bank: MemoryBank;
	private readonly featureTokens: GPUBuffer;
	private readonly positionTokens: GPUBuffer;

	constructor(
		device: GPUDevice,
		private readonly sessions: Sam2Sessions,
		constants: ModelConstants,
	) {
		this.preprocessor = new FramePreprocessor(device, constants.image_mean, constants.image_std);
		this.transposer = new TokenTransposer(device);
		this.bank = new MemoryBank(device, constants.memory_temporal_positional_encoding);
		this.featureTokens = createStorageBuffer(device, FEAT_TOKENS * HIDDEN_DIM * BYTES_PER_FLOAT, 'sam2 vision tokens');
		this.positionTokens = createStorageBuffer(device, FEAT_TOKENS * HIDDEN_DIM * BYTES_PER_FLOAT, 'sam2 position tokens');
	}

	/** Segments the object at `points` and makes this the frame every later one is tracked from. */
	async seed(frame: VideoFrame, rotation: Rotation, points: Sam2Point[], index: number): Promise<Sam2Mask> {
		if (points.length === 0) throw new Error('A prompt needs at least one point');

		const prompt: Prompt = {
			points: floatTensor(points.flatMap((point) => [point.x * IMAGE_SIZE, point.y * IMAGE_SIZE]), [1, 1, points.length, 2]),
			labels: intTensor(points.map((point) => point.label), [1, 1, points.length]),
		};

		const vision = await this.encode(frame, rotation);
		try {
			return await this.segment(vision, vision.feats2_no_mem!, prompt, { index, prompted: true });
		} finally {
			disposeOutputs(vision);
		}
	}

	/** Finds the seeded object in a frame `index` steps along from the last one. */
	async track(frame: VideoFrame, rotation: Rotation, index: number, totalFrames: number): Promise<Sam2Mask> {
		const vision = await this.encode(frame, rotation);
		try {
			this.transposer.run(gpuBuffer(vision, 'feats2'), this.featureTokens);
			this.transposer.run(gpuBuffer(vision, 'vision_pos_embed'), this.positionTokens);

			const distances = this.bank.assemble(index, totalFrames);
			const temporal = await this.sessions.pointerTpos.run({ normalized_diffs: floatTensor(distances, [MAX_POINTERS]) });
			this.bank.setPointerPositions(gpuBuffer(temporal, 'pointer_pos'));
			disposeOutputs(temporal);

			const attended = await this.sessions.memoryAttention.run({
				current_vision_features: gpuTensor(this.featureTokens, [FEAT_TOKENS, 1, HIDDEN_DIM]),
				current_vision_position_embeddings: gpuTensor(this.positionTokens, [FEAT_TOKENS, 1, HIDDEN_DIM]),
				memory: gpuTensor(this.bank.memory, [MEMORY_ROWS, 1, MEM_DIM]),
				memory_pos: gpuTensor(this.bank.memoryPos, [MEMORY_ROWS, 1, MEM_DIM]),
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
		this.bank.dispose();
		this.preprocessor.dispose();
		this.featureTokens.destroy();
		this.positionTokens.destroy();
		for (const session of Object.values(this.sessions)) void session.release();
	}

	private async encode(frame: VideoFrame, rotation: Rotation): Promise<Outputs> {
		this.preprocessor.run(frame, rotation);
		return this.sessions.visionEncoder.run({
			pixel_values: gpuTensor(this.preprocessor.pixels, [1, 3, IMAGE_SIZE, IMAGE_SIZE]),
		});
	}

	/** Decodes the mask, then encodes the frame into memory as the prompted frame or the next tracked one. */
	private async segment(vision: Outputs, conditioned: Tensor, prompt: Prompt, frame: { index: number; prompted: boolean }): Promise<Sam2Mask> {
		const decoded = await this.sessions.maskDecoder.run({
			feats0: vision.feats0!,
			feats1: vision.feats1!,
			feats2_cond: conditioned,
			input_points: prompt.points,
			input_labels: prompt.labels,
		});
		try {
			const score = floats(decoded, 'object_score_logits');
			const memory = await this.sessions.memoryEncoder.run({
				feats2: vision.feats2!,
				high_res_mask: decoded.high_res_mask!,
				object_score_logits: floatTensor(score, [1, 1]),
				binarize: floatTensor([frame.prompted ? 1 : 0], []),
			});
			try {
				if (!this.bank.hasPositions) {
					this.bank.setPositions((await memory.memory_pos!.getData()) as Float32Array);
				}

				const tokens = gpuBuffer(memory, 'memory_tokens');
				const pointer = gpuBuffer(decoded, 'object_pointer');
				if (frame.prompted) this.bank.condition(frame.index, tokens, pointer);
				else this.bank.push(frame.index, tokens, pointer);
			} finally {
				disposeOutputs(memory);
			}

			return packMask(floats(decoded, 'low_res_mask'), score[0]!, floats(decoded, 'iou')[0]!);
		} finally {
			disposeOutputs(decoded);
		}
	}
}

/** What the decoder is prompted with on frames that have no points of their own. */
function paddingPrompt(): Prompt {
	return { points: floatTensor([0, 0], [1, 1, 1, 2]), labels: intTensor([-1], [1, 1, 1]) };
}
