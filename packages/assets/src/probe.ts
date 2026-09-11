/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What a file is: its MIME type and the type-specific metadata the runtime
// needs before it can size or time an asset (dimensions, duration, tracks).

import { ALL_FORMATS, BlobSource, canDecodeVideo, Input, UrlSource, VIDEO_CODECS } from 'mediabunny';

import type { InputAudioTrack, InputTrack, InputVideoTrack, VideoCodec } from 'mediabunny';
import type { Asset } from './types';

export const DEFAULT_SEQUENCE_FPS = 30;

/** Type-specific fields of an asset, as found by `probeMedia`. */
export type ProbeResult = Extract<
	| { type: 'IMAGE'; width: number; height: number }
	| { type: 'AUDIO'; duration: number; sampleRate: number; channels: number }
	| { type: 'VIDEO'; duration: number; width: number; height: number; frameRate: number; bitRate: number; codec: string | null; sampleRate?: number; channels?: number }
	| { type: 'TRANSCRIPT' }
	| { type: 'SCRIPT' },
	{ type: Asset['type'] }
>;

/**
 * Whether this machine can decode a video track. WebCodecs gets
 * decoders the platform actually has.
 */
export async function canDecodeVideoTrack(track: InputVideoTrack): Promise<boolean> {
	if (typeof VideoDecoder === 'undefined') return true;
	try {
		return await track.canDecode();
	} catch {
		return true;
	}
}

/**
 * Whether this machine can decode an audio track. The counterpart of
 * {@link canDecodeVideoTrack}, with the same fail-open rule: a host without
 * WebCodecs is told nothing, so it calls nothing undecodable on a guess.
 */
export async function canDecodeAudioTrack(track: InputAudioTrack): Promise<boolean> {
	if (typeof AudioDecoder === 'undefined') return true;
	try {
		return await track.canDecode();
	} catch {
		return true;
	}
}

/**
 * Whether this machine can decode a video codec, for a caller that has the
 * codec but no track: an asset read back from the project manifest. The
 * decodability of the machine that imported it is not written to the manifest
 * (it is not a property of the file), so this is asked again wherever the
 * answer matters.
 *
 * The three answers are told apart because they mean different things:
 * `undefined` is an asset nobody has probed (a manifest written before the
 * codec was recorded) and gets no claim; null is a probe that could not name
 * the codec, and mediabunny can build no decoder config for such a track, so
 * nothing decodes it; anything else is asked of WebCodecs. The same fail-open
 * rule as {@link canDecodeVideoTrack} covers the rest: no WebCodecs, or a name
 * this build does not know, and nothing is claimed.
 */
export async function canDecodeVideoCodec(codec: string | null | undefined): Promise<boolean> {
	if (codec === undefined) return true;
	if (codec === null) return false;
	if (!(VIDEO_CODECS as readonly string[]).includes(codec)) return true;
	if (typeof VideoDecoder === 'undefined') return true;
	try {
		return await canDecodeVideo(codec as VideoCodec);
	} catch {
		return true;
	}
}

const TRANSCRIPT_TYPES = new Set(['application/json', 'application/x-subrip', 'text/vtt']);

/**
 * The MIME type of a file, or of the resource behind a URL. Subtitle files go
 * by extension (OS registries rarely map .srt); images fall back to their
 * magic bytes when nothing declared a type (a download filed without an
 * extension has none to go by); audio and video are sniffed by mediabunny,
 * since a container's declared type is often wrong or empty. Null when the
 * file is not something the library takes.
 */
export async function detectMimeType(input: Blob | string): Promise<string | null> {
	const name = typeof input === 'string' ? input.split(/[?#]/)[0]! : (input as File).name ?? '';
	let mimeType = typeof input === 'string' ? await fetchMimeType(input) : input.type;

	if (/\.srt$/i.test(name) || mimeType === 'application/x-subrip') return 'application/x-subrip';
	if (/\.vtt$/i.test(name) || mimeType === 'text/vtt') return 'text/vtt';
	if (/\.json$/i.test(name) || mimeType === 'application/json') return 'application/json';

	if (mimeType?.startsWith('image/')) return mimeType;
	if (mimeType?.startsWith('text/html')) return mimeType;

	if (typeof input !== 'string') {
		const sniffed = await sniffImageType(input);
		if (sniffed) return sniffed;
	}

	try {
		const source = typeof input === 'string' ? new UrlSource(input) : new BlobSource(input);
		mimeType = await new Input({ formats: ALL_FORMATS, source }).getMimeType();
	} catch {
		return null;
	}

	if (mimeType?.startsWith('audio/') || mimeType?.startsWith('video/')) return mimeType;
	return null;
}

/** Image container brands that ride in an ISO base media `ftyp` box. */
const IMAGE_BRANDS: Record<string, string> = {
	avif: 'image/avif',
	avis: 'image/avif',
	heic: 'image/heic',
	heix: 'image/heic',
	heim: 'image/heic',
	hevc: 'image/heic',
	mif1: 'image/heic',
	msf1: 'image/heic',
};

/**
 * The image format of a blob, read from its first bytes. Images are the one
 * kind mediabunny does not sniff, so without this a picture whose name and
 * declared type say nothing (an extension-less download, an
 * `application/octet-stream` response) looks like nothing at all.
 */
async function sniffImageType(input: Blob): Promise<string | null> {
	let bytes: Uint8Array;
	try {
		bytes = new Uint8Array(await input.slice(0, 64).arrayBuffer());
	} catch {
		return null;
	}
	if (bytes.length < 12) return null;

	const magic = (offset: number, ...signature: number[]) => signature.every((byte, index) => bytes[offset + index] === byte);
	const ascii = (offset: number, text: string) => [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0));

	if (magic(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
	if (magic(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
	if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif';
	if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
	if (magic(0, 0x42, 0x4d)) return 'image/bmp';
	if (magic(0, 0x49, 0x49, 0x2a, 0x00) || magic(0, 0x4d, 0x4d, 0x00, 0x2a)) return 'image/tiff';

	// `....ftyp<brand>` — only the still-image brands; mediabunny takes the rest.
	if (ascii(4, 'ftyp')) {
		const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
		return IMAGE_BRANDS[brand] ?? null;
	}

	// SVG is text: an `<svg>` root, possibly behind an XML declaration or comments.
	const head = new TextDecoder().decode(bytes).trimStart();
	if (/^(<\?xml|<!--|<!doctype svg|<svg[\s>])/i.test(head)) {
		const text = (await input.slice(0, 4096).text()).slice(0, 4096);
		if (/<svg[\s>]/i.test(text)) return 'image/svg+xml';
	}

	return null;
}

/**
 * Derives the type-specific asset properties of a media file. Throws when
 * the file is of no type the library takes, or is missing what its type
 * needs (a video without a video track, say).
 */
export async function probeMedia(file: Blob, mimeType: string): Promise<ProbeResult> {
	if (mimeType.startsWith('image/')) {
		const { width, height } = mimeType === 'image/svg+xml'
			? await getSvgDimensions(file)
			: await getRasterDimensions(file);
		return { type: 'IMAGE', width, height };
	}

	if (TRANSCRIPT_TYPES.has(mimeType)) return { type: 'TRANSCRIPT' };

	if (mimeType.startsWith('audio/') || mimeType.startsWith('video/')) {
		const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
		const audioTrack = await input.getPrimaryAudioTrack();
		const channels = audioTrack?.numberOfChannels;
		const sampleRate = audioTrack?.sampleRate;

		if (mimeType.startsWith('audio/')) {
			if (!sampleRate || !channels) throw new Error('Audio track not found');
			return { type: 'AUDIO', duration: await trackContentDuration(audioTrack), sampleRate, channels };
		}

		const videoTrack = await input.getPrimaryVideoTrack();
		if (!videoTrack) throw new Error('Video track not found');
		const [stats, codec] = await Promise.all([
			videoTrack.computePacketStats(),
			videoTrack.getCodec(),
		]);

		return {
			type: 'VIDEO',
			// `null` and not `undefined`: a track whose codec the library could
			// not name is a finding, and the manifest drops undefined fields.
			codec: codec ?? null,
			width: videoTrack.displayWidth,
			height: videoTrack.displayHeight,
			frameRate: stats.averagePacketRate,
			bitRate: stats.averageBitrate,
			duration: await trackContentDuration(videoTrack),
			...(sampleRate === undefined ? {} : { sampleRate }),
			...(channels === undefined ? {} : { channels }),
		};
	}

	throw new Error(`Unsupported file type: ${mimeType}`);
}

const FRAME_NAME = /^(.*?)(\d+)\.(png|jpe?g|webp|gif|avif|bmp)$/i;

/**
 * Whether a directory listing looks like an image sequence: two or more
 * numbered image files sharing one prefix and extension (`frame_0001.png`,
 * `frame_0002.png`, …) and nothing else. A folder of unrelated stills is a
 * folder, not a clip.
 */
export function isSequenceListing(names: string[]): boolean {
	const files = names.filter((name) => !name.startsWith('.'));
	if (files.length < 2) return false;
	let prefix: string | undefined;
	let extension: string | undefined;
	for (const name of files) {
		const match = FRAME_NAME.exec(name);
		if (!match) return false;
		const [, stem, , ext] = match;
		if (prefix === undefined) {
			prefix = stem;
			extension = ext!.toLowerCase();
		} else if (stem !== prefix || ext!.toLowerCase() !== extension) {
			return false;
		}
	}
	return true;
}

/** The frames of a sequence in play order: natural sort, so 2 comes before 10. */
export function sortFrames<T extends { name: string }>(frames: T[]): T[] {
	const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
	return [...frames].sort((a, b) => collator.compare(a.name, b.name));
}

async function getRasterDimensions(file: Blob): Promise<{ width: number; height: number }> {
	const bitmap = await createImageBitmap(file);
	const { width, height } = bitmap;
	bitmap.close();
	return { width, height };
}

async function getSvgDimensions(file: Blob): Promise<{ width: number; height: number }> {
	const text = await file.text();
	const root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;

	const parseLength = (value: string | null): number => {
		if (!value) return 0;
		const n = parseFloat(value);
		return Number.isFinite(n) ? n : 0;
	};

	let width = parseLength(root.getAttribute('width'));
	let height = parseLength(root.getAttribute('height'));

	if ((!width || !height) && root.getAttribute('viewBox')) {
		const parts = root.getAttribute('viewBox')!.split(/[\s,]+/).map(Number);
		if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3])) {
			width = width || parts[2]!;
			height = height || parts[3]!;
		}
	}

	// SVG spec default when neither width/height nor viewBox is declared.
	return { width: width || 300, height: height || 150 };
}

async function fetchMimeType(url: string): Promise<string | null> {
	let response: Response;
	try {
		response = await fetch(url, { method: 'HEAD' });
	} catch {
		const controller = new AbortController();
		response = await fetch(url, { signal: controller.signal });
		controller.abort();
	}
	if (!response.ok) return null;
	return response.headers.get('Content-Type');
}

/**
 * Playable content length of a media track, in seconds: the end timestamp
 * minus the track's first *presented* timestamp. A track may carry a global
 * time offset (a non-zero first timestamp); using the raw end timestamp as
 * the duration would over-report the length by that offset. A negative first
 * timestamp means the head has been trimmed by an edit list; those pre-roll
 * samples are not presented, so the start is clamped to 0.
 */
async function trackContentDuration(track?: InputTrack | null): Promise<number> {
	if (!track) return 0;
	const [start, end] = await Promise.all([track.getFirstTimestamp(), track.computeDuration()]);
	return Math.max(0, end - Math.max(0, start));
}
