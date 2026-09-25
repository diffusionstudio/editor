/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { MASK_SIZE } from './constants';

export { MASK_SIZE };

/** One frame's segmentation, at the model's mask resolution. */
export type Sam2Mask = {
	/** Row-major, one bit per pixel, most significant bit first. */
	bits: Uint8Array;
	/** Whether the object is in frame: at or below zero the model saw it occluded. */
	score: number;
	/** The model's own estimate of the mask's quality, 0 to 1. */
	iou: number;
};

const MASK_BYTES = (MASK_SIZE * MASK_SIZE) / 8;

/** Packs mask logits into bits; positive logits are foreground. */
export function packMask(logits: Float32Array, score: number, iou: number): Sam2Mask {
	const bits = new Uint8Array(MASK_BYTES);
	for (let i = 0; i < logits.length; i++) {
		if (logits[i]! > 0) bits[i >> 3]! |= 0x80 >> (i & 7);
	}
	return { bits, score, iou };
}

export function maskHas(mask: Sam2Mask, x: number, y: number): boolean {
	const i = y * MASK_SIZE + x;
	return (mask.bits[i >> 3]! & (0x80 >> (i & 7))) !== 0;
}

/** Whether any pixel is foreground. */
export function maskIsEmpty(mask: Sam2Mask): boolean {
	return mask.bits.every((byte) => byte === 0);
}

/** The mask as RGBA pixels, `color` where it is foreground and transparent elsewhere. */
export function renderMask(mask: Sam2Mask, color: [r: number, g: number, b: number, a: number]): ImageData {
	const image = new ImageData(MASK_SIZE, MASK_SIZE);
	const pixels = new Uint32Array(image.data.buffer);
	const packed = (color[3] << 24 | color[2] << 16 | color[1] << 8 | color[0]) >>> 0;

	for (let byte = 0; byte < mask.bits.length; byte++) {
		const value = mask.bits[byte]!;
		if (value === 0) continue;
		for (let bit = 0; bit < 8; bit++) {
			if (value & (0x80 >> bit)) pixels[byte * 8 + bit] = packed;
		}
	}

	return image;
}
