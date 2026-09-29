/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The thumbnail of an image, video or mask file: scaled to a width, its
// aspect ratio kept, encoded as WebP. For a video it is the frame shortly
// after the start; for a mask, its middle tracked frame. The decoder does
// the scaling (mediabunny's CanvasSink for video, createImageBitmap for
// images), so the picture is encoded once, as it comes.

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';

import { MASK_MIME_TYPE, MaskFile } from '../mask';
import { traceMask } from '../mask-outline';

/** The width the asset bar shows; what the cache stores without a variant. */
export const DEFAULT_THUMBNAIL_WIDTH = 300;

/** How far into a video the thumbnail frame is taken from, in seconds. */
const VIDEO_THUMBNAIL_OFFSET = 0.3;

const WEBP_QUALITY = 0.7;

/** A mask thumbnail's object and background: white on near-black, as a matte reads. */
const MASK_FOREGROUND = '#ffffff';
const MASK_BACKGROUND = '#1a1a1a';

/** A WebP thumbnail of `file`, `width` wide, or null when it is no image, video with a picture, or mask. */
export async function deriveThumbnail(file: Blob, mimeType: string, width = DEFAULT_THUMBNAIL_WIDTH): Promise<Blob | null> {
	if (mimeType.startsWith('image/')) return imageThumbnail(file, width);
	if (mimeType.startsWith('video/')) return videoThumbnail(file, width);
	if (mimeType === MASK_MIME_TYPE) return maskThumbnail(file, width);
	return null;
}

async function imageThumbnail(file: Blob, width: number): Promise<Blob | null> {
	const bitmap = await createImageBitmap(file, { resizeWidth: width, resizeQuality: 'high' });
	try {
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		const ctx = canvas.getContext('bitmaprenderer');
		if (!ctx) throw new Error('Could not create a bitmaprenderer context');
		ctx.transferFromImageBitmap(bitmap);
		return await encode(canvas);
	} finally {
		bitmap.close();
	}
}

async function videoThumbnail(file: Blob, width: number): Promise<Blob | null> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) return null;
		const sink = new CanvasSink(track, { width });
		const first = await track.getFirstTimestamp();
		const wrapped = (await sink.getCanvas(first + VIDEO_THUMBNAIL_OFFSET)) ?? (await sink.getCanvas(first));
		if (!wrapped) return null;
		return await encode(wrapped.canvas);
	} finally {
		input.dispose();
	}
}

async function maskThumbnail(file: Blob, width: number): Promise<Blob | null> {
	const mask = await MaskFile.read(file);
	const { gridWidth, gridHeight, width: frameWidth, height: frameHeight, frameCount } = mask.header;
	const tracked: number[] = [];
	for (let i = 0; i < frameCount; i++) if (mask.has(i)) tracked.push(i);
	const middle = tracked[Math.floor(tracked.length / 2)];
	if (middle === undefined || !gridWidth || !gridHeight) return null;

	const field = new Int8Array(gridWidth * gridHeight);
	mask.field(middle, field);
	const outline = new Path2D();
	traceMask(field, gridWidth, gridHeight, outline);

	const height = Math.max(1, Math.round((width * (frameHeight || gridHeight)) / (frameWidth || gridWidth)));
	const canvas = new OffscreenCanvas(width, height);
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = MASK_BACKGROUND;
	ctx.fillRect(0, 0, width, height);
	ctx.scale(width / gridWidth, height / gridHeight);
	ctx.fillStyle = MASK_FOREGROUND;
	ctx.fill(outline);
	return encode(canvas);
}

function encode(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob | null> {
	if (canvas instanceof OffscreenCanvas) return canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
	return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY));
}
