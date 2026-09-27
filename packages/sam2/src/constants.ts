/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export type Sam2ModelId = 'tiny' | 'small' | 'base-plus' | 'large';

export type ModelFileKey = 'constants' | 'visionEncoder' | 'maskDecoder' | 'memoryEncoder' | 'memoryAttention' | 'pointerTpos';

/**
 * A SAM 2.1 export, made by `scripts/export.py <size> <imageSize> 7`: fixed
 * shapes for `imageSize` and `MEMORY_FRAMES`, fp16 compute behind fp32 inputs
 * and outputs. The repo is pinned to a commit, which is part of the cache key
 * and what a mask's recipe names.
 */
export type Sam2Model = {
	id: Sam2ModelId;
	label: string;
	repo: string;
	imageSize: number;
	files: Record<ModelFileKey, { path: string; size: number }>;
};

/**
 * The models on offer, fastest first. Tiny runs at half the resolution
 * SAM 2 was trained at, a quarter of the encoder's work; the larger ones at
 * the full 1024, for the detail and small objects they are chosen for.
 */
export const SAM2_MODELS: readonly Sam2Model[] = [
	{
		id: 'tiny',
		label: 'Tiny',
		repo: 'https://huggingface.co/diffusionstudio/sam2.1-tiny-video-onnx-fp16/resolve/66673b5db39371b7dd7847f4d3bc0d4f4179b79e',
		imageSize: 512,
		files: {
			constants: { path: 'constants.json', size: 9_781 },
			visionEncoder: { path: 'onnx/vision_encoder.onnx', size: 58_385_353 },
			maskDecoder: { path: 'onnx/mask_decoder.onnx', size: 8_898_805 },
			memoryEncoder: { path: 'onnx/memory_encoder.onnx', size: 2_807_753 },
			memoryAttention: { path: 'onnx/memory_attention.onnx', size: 13_029_470 },
			pointerTpos: { path: 'onnx/pointer_tpos.onnx', size: 34_228 },
		},
	},
	{
		id: 'small',
		label: 'Small',
		repo: 'https://huggingface.co/diffusionstudio/sam2.1-small-video-onnx-fp16/resolve/927ecec6e6ae2727d0af7720eefdb07f2efe4689',
		imageSize: 1024,
		files: {
			constants: { path: 'constants.json', size: 9_820 },
			visionEncoder: { path: 'onnx/vision_encoder.onnx', size: 83_679_474 },
			maskDecoder: { path: 'onnx/mask_decoder.onnx', size: 8_910_345 },
			memoryEncoder: { path: 'onnx/memory_encoder.onnx', size: 2_807_884 },
			memoryAttention: { path: 'onnx/memory_attention.onnx', size: 16_175_204 },
			pointerTpos: { path: 'onnx/pointer_tpos.onnx', size: 34_228 },
		},
	},
	{
		id: 'base-plus',
		label: 'Base+',
		repo: 'https://huggingface.co/diffusionstudio/sam2.1-base-plus-video-onnx-fp16/resolve/386b83e09a774fe2782d86fd1b8cb5aaf718aa9d',
		imageSize: 1024,
		files: {
			constants: { path: 'constants.json', size: 9_857 },
			visionEncoder: { path: 'onnx/vision_encoder.onnx', size: 155_490_079 },
			maskDecoder: { path: 'onnx/mask_decoder.onnx', size: 8_910_345 },
			memoryEncoder: { path: 'onnx/memory_encoder.onnx', size: 2_807_648 },
			memoryAttention: { path: 'onnx/memory_attention.onnx', size: 16_169_156 },
			pointerTpos: { path: 'onnx/pointer_tpos.onnx', size: 34_228 },
		},
	},
	{
		id: 'large',
		label: 'Large',
		repo: 'https://huggingface.co/diffusionstudio/sam2.1-large-video-onnx-fp16/resolve/98dbd222d9b3f75d15fe63a5c2a22b0b0029eea1',
		imageSize: 1024,
		files: {
			constants: { path: 'constants.json', size: 9_752 },
			visionEncoder: { path: 'onnx/vision_encoder.onnx', size: 447_430_045 },
			maskDecoder: { path: 'onnx/mask_decoder.onnx', size: 8_910_364 },
			memoryEncoder: { path: 'onnx/memory_encoder.onnx', size: 2_807_886 },
			memoryAttention: { path: 'onnx/memory_attention.onnx', size: 16_175_204 },
			pointerTpos: { path: 'onnx/pointer_tpos.onnx', size: 34_228 },
		},
	},
];

export const DEFAULT_SAM2_MODEL: Sam2ModelId = 'tiny';

export function sam2Model(id: Sam2ModelId): Sam2Model {
	const model = SAM2_MODELS.find((entry) => entry.id === id);
	if (!model) throw new Error(`There is no SAM 2.1 model ${id}`);
	return model;
}

/** The model a mask's recipe names by its pinned repo; undefined for one no longer offered. */
export function sam2ModelOfRepo(repo: string): Sam2Model | undefined {
	return SAM2_MODELS.find((entry) => entry.repo === repo);
}

/** Bytes to fetch for `model` when none of it is cached. */
export function downloadSize(model: Sam2Model): number {
	return Object.values(model.files).reduce((sum, file) => sum + file.size, 0);
}

export const HIDDEN_DIM = 256;
export const MEM_DIM = 64;
export const MEMORY_FRAMES = 7;
export const MAX_POINTERS = 16;
export const POINTER_TOKENS = HIDDEN_DIM / MEM_DIM;
export const DECODED_MASK_SIZE = 256;

export const BYTES_PER_FLOAT = 4;
export const MEMORY_ROW_BYTES = MEM_DIM * BYTES_PER_FLOAT;
export const POINTER_BYTES = HIDDEN_DIM * BYTES_PER_FLOAT;

/** The sizes a model's input resolution sets: its grids, its buffers and its shaders. */
export type Sam2Geometry = {
	imageSize: number;
	maskSize: number;
	featSize: number;
	featTokens: number;
	memoryRows: number;
	memoryBlockBytes: number;
};

export function geometryOf(imageSize: number): Sam2Geometry {
	const featSize = imageSize / 16;
	const featTokens = featSize * featSize;
	return {
		imageSize,
		maskSize: imageSize / 4,
		featSize,
		featTokens,
		memoryRows: MEMORY_FRAMES * featTokens + MAX_POINTERS * POINTER_TOKENS,
		memoryBlockBytes: featTokens * MEMORY_ROW_BYTES,
	};
}

/** The values `constants.json` in the model repo carries. */
export type ModelConstants = {
	image_size: number;
	memory_frames: number;
	image_mean: [number, number, number];
	image_std: [number, number, number];
	memory_temporal_positional_encoding: number[][];
};
