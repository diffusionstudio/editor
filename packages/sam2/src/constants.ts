/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Made by `scripts/export.py 512 7`: fixed shapes for `IMAGE_SIZE` and
 * `MEMORY_FRAMES` below, fp16 compute behind fp32 inputs and outputs.
 * Pinned to a commit, which is part of the cache key.
 */
export const MODEL_REPO = 'https://huggingface.co/diffusionstudio/sam2.1-tiny-video-onnx-fp16/resolve/66673b5db39371b7dd7847f4d3bc0d4f4179b79e';

export const MODEL_FILES = {
	constants: { path: 'constants.json', size: 9_781 },
	visionEncoder: { path: 'onnx/vision_encoder.onnx', size: 58_385_353 },
	maskDecoder: { path: 'onnx/mask_decoder.onnx', size: 8_898_805 },
	memoryEncoder: { path: 'onnx/memory_encoder.onnx', size: 2_807_753 },
	memoryAttention: { path: 'onnx/memory_attention.onnx', size: 13_029_470 },
	pointerTpos: { path: 'onnx/pointer_tpos.onnx', size: 34_228 },
} as const;

/** The model's input, half the resolution SAM 2 was trained at: a quarter of the encoder's work. */
export const IMAGE_SIZE = 512;
/** The decoder's masks, upsampled in-graph from its own `IMAGE_SIZE / 4`. */
export const MASK_SIZE = 256;
export const FEAT_SIZE = IMAGE_SIZE / 16;
export const FEAT_TOKENS = FEAT_SIZE * FEAT_SIZE;
export const HIDDEN_DIM = 256;
export const MEM_DIM = 64;
export const MEMORY_FRAMES = 7;
export const MAX_POINTERS = 16;
export const POINTER_TOKENS = HIDDEN_DIM / MEM_DIM;
export const MEMORY_ROWS = MEMORY_FRAMES * FEAT_TOKENS + MAX_POINTERS * POINTER_TOKENS;

export const BYTES_PER_FLOAT = 4;
export const MEMORY_ROW_BYTES = MEM_DIM * BYTES_PER_FLOAT;
export const MEMORY_BLOCK_BYTES = FEAT_TOKENS * MEMORY_ROW_BYTES;
export const POINTER_BYTES = HIDDEN_DIM * BYTES_PER_FLOAT;

/** The values `constants.json` in the model repo carries. */
export type ModelConstants = {
	image_size: number;
	memory_frames: number;
	image_mean: [number, number, number];
	image_std: [number, number, number];
	memory_temporal_positional_encoding: number[][];
};
