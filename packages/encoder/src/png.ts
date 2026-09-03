/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// PNG in and out of a canvas, as bytes. Transports decide how bytes travel
// (base64 on a JSON wire, structured clone over IPC, a file on disk); nothing
// in the render path should have to know.

export async function encodePng(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Uint8Array> {
	const blob =
		canvas instanceof OffscreenCanvas
			? await canvas.convertToBlob({ type: 'image/png' })
			: await new Promise<Blob>((resolve, reject) => {
					canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('Could not encode PNG'))), 'image/png');
				});
	return new Uint8Array(await blob.arrayBuffer());
}

export function decodePng(png: Uint8Array): Promise<ImageBitmap> {
	return createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }));
}
