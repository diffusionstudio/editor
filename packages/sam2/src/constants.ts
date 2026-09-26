/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The graphs compute in fp16 but take and return fp32, so the pipeline is the
 * same as for the fp32 export they are built from; `scripts/convert_fp16.py`
 * makes them. Pinned to a commit, which is part of the cache key.
 */
export const MODEL_REPO = 'https://huggingface.co/diffusionstudio/sam2.1-tiny-video-onnx-fp16/resolve/9a1ecaa5b194cc9c5bd7840036301037fe3f6b13';

export const MODEL_FILES = {
	constants: { path: 'constants.json', size: 9_922 },
	visionEncoder: { path: 'onnx/vision_encoder.onnx', size: 67_221_881 },
	maskDecoder: { path: 'onnx/mask_decoder.onnx', size: 8_928_987 },
	memoryEncoder: { path: 'onnx/memory_encoder.onnx', size: 2_822_478 },
	memoryAttention: { path: 'onnx/memory_attention.onnx', size: 16_220_704 },
	pointerTpos: { path: 'onnx/pointer_tpos.onnx', size: 34_236 },
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
