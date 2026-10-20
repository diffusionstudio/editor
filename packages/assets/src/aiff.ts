/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// AIFF and AIFF-C. mediabunny has no AIFF reader and Chromium's <audio> opens
// none, but both read PCM out of a QuickTime movie, and QuickTime's sound
// sample entries are AIFF-C's own compression types.

export const AIFF_MIME = 'audio/aiff';

export class AiffError extends Error {
	override name = 'AiffError';
}

export type Encoding = 's8' | 'u8' | 's16be' | 's16le' | 's24be' | 's32be' | 'f32be' | 'f64be';

const kAudioFormatFlagIsFloat = 1;
const kAudioFormatFlagIsBigEndian = 2;
const kAudioFormatFlagIsSignedInteger = 4;
const kAudioFormatFlagIsPacked = 8;

/**
 * `lpcm` is the only entry that holds a rate of 65535 Hz or more, or a fractional one, and mediabunny
 * reads no 64-bit float from it, so `f64be` has no flags.
 */
const ENCODINGS: Readonly<Record<Encoding, { bytes: number; fourcc: string; flags: number | null }>> = {
	s8: { bytes: 1, fourcc: 'twos', flags: kAudioFormatFlagIsBigEndian | kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked },
	u8: { bytes: 1, fourcc: 'raw ', flags: kAudioFormatFlagIsBigEndian | kAudioFormatFlagIsPacked },
	s16be: { bytes: 2, fourcc: 'twos', flags: kAudioFormatFlagIsBigEndian | kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked },
	s16le: { bytes: 2, fourcc: 'sowt', flags: kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked },
	s24be: { bytes: 3, fourcc: 'in24', flags: kAudioFormatFlagIsBigEndian | kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked },
	s32be: { bytes: 4, fourcc: 'in32', flags: kAudioFormatFlagIsBigEndian | kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked },
	f32be: { bytes: 4, fourcc: 'fl32', flags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsBigEndian | kAudioFormatFlagIsPacked },
	f64be: { bytes: 8, fourcc: 'fl64', flags: null },
};

/** A big-endian integer sample of `bits` bits, which AIFF left-justifies in whole bytes. */
const integer = (bits: number): Encoding | null =>
	bits < 1 ? null : bits <= 8 ? 's8' : bits <= 16 ? 's16be' : bits <= 24 ? 's24be' : bits <= 32 ? 's32be' : null;

/** Not here, so refused: `ulaw`/`alaw`, which mediabunny decodes at 0.25x and -0.125x of the true level. */
const COMPRESSIONS: Readonly<Record<string, (sampleSize: number) => Encoding | null>> = {
	NONE: integer,
	twos: integer,
	in24: () => 's24be',
	in32: () => 's32be',
	sowt: (sampleSize) => (sampleSize === 16 ? 's16le' : null),
	'raw ': () => 'u8',
	fl32: () => 'f32be',
	FL32: () => 'f32be',
	fl64: () => 'f64be',
	FL64: () => 'f64be',
};

export interface AiffLayout {
	channels: number;
	/** Not always whole: the classic Mac rate is 22254.5454 Hz. */
	sampleRate: number;
	frames: number;
	encoding: Encoding;
	dataStart: number;
	dataLength: number;
}

const MAX_HEADER_LENGTH = 2 ** 16;
const MAX_DATA_LENGTH = 0xffffffff - MAX_HEADER_LENGTH;

const fitsVersion0 = (rate: number) => Number.isInteger(rate) && rate <= 0xffff;

const ascii = (bytes: Uint8Array, at: number, length = 4): string => String.fromCharCode(...bytes.subarray(at, at + length));
const viewOf = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const readBytes = async (blob: Blob, start: number, length: number) => new Uint8Array(await blob.slice(start, start + length).arrayBuffer());

function readExtended80(bytes: Uint8Array, at: number): number {
	const view = viewOf(bytes);
	const sign = view.getUint16(at) & 0x8000 ? -1 : 1;
	const exponent = view.getUint16(at) & 0x7fff;
	const mantissa = view.getUint32(at + 2) * 2 ** 32 + view.getUint32(at + 6);
	if (exponent === 0x7fff) return Number.NaN;
	return sign * mantissa * 2 ** (exponent - 16383 - 63);
}

const CONTAINERS: Readonly<Record<string, 'AIFF' | 'AIFF-C'>> = { AIFF: 'AIFF', AIFC: 'AIFF-C' };

export async function aiffContainer(blob: Blob): Promise<'AIFF' | 'AIFF-C' | null> {
	try {
		const head = await readBytes(blob, 0, 12);
		return head.length === 12 && ascii(head, 0) === 'FORM' ? (CONTAINERS[ascii(head, 8)] ?? null) : null;
	} catch {
		return null;
	}
}

export const isAiffType = (type: string | null): boolean => !!type && /^audio\/(x-)?aif[fc]?$/i.test(type.split(';')[0]!.trim());

export async function readAiffLayout(file: Blob): Promise<AiffLayout> {
	const head = await readBytes(file, 0, 12);
	const form = ascii(head, 8);
	if (head.length < 12 || ascii(head, 0) !== 'FORM' || (form !== 'AIFF' && form !== 'AIFC')) throw new AiffError('not an AIFF file');

	let comm: { channels: number; frames: number; sampleSize: number; sampleRate: number; compression: string; compressionName: string } | undefined;
	let ssnd: { start: number; end: number } | undefined;
	for (let pos = 12; pos + 8 <= file.size && !(comm && ssnd); ) {
		const header = await readBytes(file, pos, 8);
		const id = ascii(header, 0);
		const size = viewOf(header).getUint32(4);
		const body = pos + 8;
		if (id === 'COMM') {
			const bytes = await readBytes(file, body, Math.min(size, 22 + 256));
			if (bytes.length >= 18) {
				const view = viewOf(bytes);
				const aifc = form === 'AIFC' && bytes.length >= 22;
				comm = {
					channels: view.getInt16(0),
					frames: view.getUint32(2),
					sampleSize: view.getInt16(6),
					sampleRate: readExtended80(bytes, 8),
					compression: aifc ? ascii(bytes, 18) : 'NONE',
					compressionName: aifc && bytes.length > 22 ? new TextDecoder().decode(bytes.subarray(23, 23 + bytes[22])) : '',
				};
			}
		} else if (id === 'SSND') {
			const offset = viewOf(await readBytes(file, body, 8)).getUint32(0);
			const declared = size - 8 - offset;
			const start = body + 8 + offset;
			// A writer that streams leaves the size at 0, so a chunk that declares no data runs to the end of the file.
			ssnd = { start, end: declared > 0 ? Math.min(start + declared, file.size) : file.size };
		}
		pos = body + size + (size & 1);
	}
	if (!comm) throw new AiffError('it has no COMM chunk');
	if (!ssnd) throw new AiffError('it has no SSND chunk');

	const { channels, sampleSize, sampleRate, compression } = comm;
	const encoding = COMPRESSIONS[compression]?.(sampleSize);
	if (!encoding) {
		const kind = form === 'AIFC' ? `AIFF-C compression '${compression}'${comm.compressionName ? ` (${comm.compressionName})` : ''}` : 'AIFF';
		throw new AiffError(`${kind}${compression in COMPRESSIONS ? ` at ${sampleSize} bits` : ''} is not one the editor reads`);
	}
	if (channels < 1) throw new AiffError(`it has ${channels} channels`);
	if (!(sampleRate > 0 && sampleRate <= 0xffffffff)) throw new AiffError(`its sample rate is ${sampleRate} Hz`);
	if (ENCODINGS[encoding].flags === null && !fitsVersion0(sampleRate)) {
		throw new AiffError(`64-bit float at ${sampleRate} Hz is not one the editor reads (whole rates up to 65535 Hz only)`);
	}

	const frameBytes = channels * ENCODINGS[encoding].bytes;
	const held = Math.floor(Math.max(0, ssnd.end - ssnd.start) / frameBytes);
	// A streaming writer may leave COMM's count at 0; then what SSND holds is the sound.
	const frames = Math.min(comm.frames || held, held);
	if (frames === 0) throw new AiffError('it has no sound');
	const dataLength = frames * frameBytes;
	if (dataLength > MAX_DATA_LENGTH) throw new AiffError('its sound is too large for the editor to read in place (4 GiB)');
	return { channels, sampleRate, frames, encoding, dataStart: ssnd.start, dataLength };
}

const bytesOf = (size: number, write: (view: DataView) => void): Uint8Array<ArrayBuffer> => {
	const out = new Uint8Array(size);
	write(new DataView(out.buffer));
	return out;
};
const u16 = (n: number) => bytesOf(2, (v) => v.setUint16(0, n));
const u32 = (n: number) => bytesOf(4, (v) => v.setUint32(0, n));
const f64 = (n: number) => bytesOf(8, (v) => v.setFloat64(0, n));
const four = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));
const zeros = (n: number) => new Uint8Array(n);

const cat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
	const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
};

const box = (type: string, ...payload: Uint8Array[]) => {
	const body = cat(...payload);
	return cat(u32(8 + body.length), four(type), body);
};
const fullBox = (type: string, ...payload: Uint8Array[]) => box(type, zeros(4), ...payload);
const IDENTITY = cat(u32(0x10000), zeros(12), u32(0x10000), zeros(12), u32(0x40000000));

const MAX_CHUNKS = 4096;
/** The view's packets match the packets mediabunny cuts from a WAVE, so an AIFF reaches the player as its WAV would. */
const MIN_CHUNK_FRAMES = 2048;

function soundEntry({ channels, sampleRate, encoding }: AiffLayout): Uint8Array {
	const { bytes, fourcc, flags } = ENCODINGS[encoding];
	if (fitsVersion0(sampleRate)) {
		return box(fourcc, zeros(6), u16(1), u16(0), u16(0), u32(0), u16(channels), u16(bytes * 8), u16(0), u16(0), u32(sampleRate * 0x10000));
	}
	return box('lpcm', zeros(6), u16(1), u16(2), u16(0), u32(0), u16(3), u16(16), u16(0xfffe), u16(0), u32(0x10000), u32(72),
		f64(sampleRate), u32(channels), u32(0x7f000000), u32(bytes * 8), u32(flags!), u32(bytes * channels), u32(1));
}

function movie(layout: AiffLayout, firstChunkAt: number): Uint8Array<ArrayBuffer> {
	const { channels, frames, encoding, sampleRate } = layout;
	const frameBytes = channels * ENCODINGS[encoding].bytes;
	const timescale = Math.max(1, Math.round(sampleRate));
	const chunkFrames = Math.max(MIN_CHUNK_FRAMES, Math.ceil(frames / MAX_CHUNKS));
	const whole = Math.floor(frames / chunkFrames);
	const rest = frames - whole * chunkFrames;
	const chunks = whole + (rest ? 1 : 0);

	const offsets = bytesOf(4 * chunks, (view) => {
		for (let i = 0; i < chunks; i++) view.setUint32(4 * i, firstChunkAt + i * chunkFrames * frameBytes);
	});
	const runs = cat(whole ? cat(u32(1), u32(chunkFrames), u32(1)) : zeros(0), rest ? cat(u32(whole + 1), u32(rest), u32(1)) : zeros(0));

	const stbl = box('stbl',
		fullBox('stsd', u32(1), soundEntry(layout)),
		fullBox('stts', u32(1), u32(frames), u32(1)),
		fullBox('stsc', u32(whole && rest ? 2 : 1), runs),
		fullBox('stsz', u32(frameBytes), u32(frames)),
		fullBox('stco', u32(chunks), offsets));
	const selfContained = box('url ', Uint8Array.of(0, 0, 0, 1));
	const minf = box('minf', fullBox('smhd', u32(0)), box('dinf', fullBox('dref', u32(1), selfContained)), stbl);
	const mdia = box('mdia',
		fullBox('mdhd', u32(0), u32(0), u32(timescale), u32(frames), u16(0x55c4), u16(0)),
		fullBox('hdlr', u32(0), four('soun'), zeros(12), Uint8Array.of(0)),
		minf);
	const trak = box('trak',
		box('tkhd', Uint8Array.of(0, 0, 0, 0x0f), u32(0), u32(0), u32(1), u32(0), u32(frames), zeros(8), u16(0), u16(0), u16(0x0100), u16(0), IDENTITY, u32(0), u32(0)),
		mdia);
	return box('moov',
		fullBox('mvhd', u32(0), u32(0), u32(timescale), u32(frames), u32(0x10000), u16(0x0100), zeros(10), IDENTITY, zeros(24), u32(2)),
		trak);
}

function quickTimeHeader(layout: AiffLayout): Uint8Array<ArrayBuffer> {
	const ftyp = box('ftyp', four('qt  '), u32(0), four('qt  '));
	const mdat = cat(u32(layout.dataLength + 8), four('mdat'));
	const header = (firstChunkAt: number) => cat(ftyp, movie(layout, firstChunkAt), mdat);
	const headerLength = header(0).length;
	return header(headerLength);
}

export async function mediaOf(original: File, mimeType: string): Promise<File> {
	if (mimeType !== AIFF_MIME) return original;
	const layout = await readAiffLayout(original);
	const samples = original.slice(layout.dataStart, layout.dataStart + layout.dataLength);
	return new File([quickTimeHeader(layout), samples], original.name, { type: 'audio/quicktime', lastModified: original.lastModified });
}
