/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export const MODEL_REPO = 'https://huggingface.co/square-zero-labs/sam2.1-tiny-video-onnx/resolve/main';

export const MODEL_FILES = {
	constants: { path: 'constants.json', size: 9_922 },
	visionEncoder: { path: 'onnx/vision_encoder.onnx', size: 134_335_567 },
	maskDecoder: { path: 'onnx/mask_decoder.onnx', size: 17_794_355 },
	memoryEncoder: { path: 'onnx/memory_encoder.onnx', size: 5_616_496 },
	memoryAttention: { path: 'onnx/memory_attention.onnx', size: 32_259_165 },
	pointerTpos: { path: 'onnx/pointer_tpos.onnx', size: 67_289 },
} as const;

export const IMAGE_SIZE = 1024;
export const MASK_SIZE = 256;
export const FEAT_SIZE = 64;
export const FEAT_TOKENS = FEAT_SIZE * FEAT_SIZE;
export const HIDDEN_DIM = 256;
export const MEM_DIM = 64;
export const NUM_MASKMEM = 7;
export const MAX_POINTERS = 16;
export const POINTER_TOKENS = HIDDEN_DIM / MEM_DIM;
export const MEMORY_ROWS = NUM_MASKMEM * FEAT_TOKENS + MAX_POINTERS * POINTER_TOKENS;

export const BYTES_PER_FLOAT = 4;
export const MEMORY_ROW_BYTES = MEM_DIM * BYTES_PER_FLOAT;
export const MEMORY_BLOCK_BYTES = FEAT_TOKENS * MEMORY_ROW_BYTES;
export const POINTER_BYTES = HIDDEN_DIM * BYTES_PER_FLOAT;

/** The values `constants.json` in the model repo carries. */
export type ModelConstants = {
	image_mean: [number, number, number];
	image_std: [number, number, number];
	memory_temporal_positional_encoding: number[][];
};
