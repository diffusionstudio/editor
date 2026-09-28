/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { quantizeLogit } from '@diffusionstudio/assets';

import type { MaskFrame } from '@diffusionstudio/assets';
import type { Sam2Mask } from '@diffusionstudio/sam2/mask';

/**
 * The model's mask as a mask file's frame: its logits quantized, a byte a
 * cell (see `quantizeLogit`). Tracked frames are kept so, a quarter of the
 * logits' size, from the moment they arrive.
 */
export function maskFrame(mask: Sam2Mask): MaskFrame {
	const field = new Int8Array(mask.logits.length);
	for (let i = 0; i < field.length; i++) field[i] = quantizeLogit(mask.logits[i]!);
	return { field, score: mask.score, iou: mask.iou };
}
