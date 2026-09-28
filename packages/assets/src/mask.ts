/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The mask file: a tracked matte's frames in one file, with the recipe that
// made them. A frame is a field — the model's logits on its own grid, one
// signed byte a cell (see `quantizeLogit`) — so the file keeps where the
// model put the edge between cells, not only which cells are in. The object
// is where the field is above zero. Most of a frame is saturated, far in or
// far out, and coded as runs; only the cells near the edge are written out.
// A minute of a person-sized object is a few megabytes, written once.
// The grid is stretched over the footage's frame (`width` by `height`), which
// is what a renderer fits it into; tracing its edge is the renderer's (see
// `traceMask`).
//
// The recipe (see `MaskRecipe`) is how the frames can be made again: the
// footage, the prompt, the span. The library keeps it in the manifest as well,
// so a mask whose file went missing still knows how it was made.
//
// Layout, little-endian:
//
//   0       'DSMK'      magic
//   4       u32         version
//   8       u32 n       byte length of the header
//   12      n bytes     header: UTF-8 JSON, a `MaskHeader`
//   12 + n  table       per frame: u32 offset (from the data), u32 length,
//                       f32 score, f32 iou
//   …       data        the frames' runs, back to back
//
// A frame covers its grid row-major in runs, each an unsigned LEB128 varint
// of its length times four plus its kind: 0 a run of cells saturated out
// (-127), 1 saturated in (+127), 2 that many cells written out after it, a
// signed byte each. A frame of length 0 has no mask (it was not tracked).

export const MASK_MIME_TYPE = 'application/x-diffusionstudio-mask';
export const MASK_EXTENSION = 'mask';

const MAGIC = [0x44, 0x53, 0x4d, 0x4b]; // 'DSMK'
const VERSION = 2;
const PREAMBLE_BYTES = 12;
const TABLE_ENTRY_BYTES = 16;

/** A field cell saturated in; its negation, saturated out. */
export const MASK_FIELD_MAX = 127;

/**
 * The logit a field byte's tanh is scaled by: a byte resolves the edge to a
 * hundredth of a cell where the model's logits cross zero, and saturates a
 * cell or two away, where the model is sure.
 */
const LOGIT_SCALE = 2;

/**
 * A logit as a field byte: `127 tanh(logit / 2)`, fine near zero and
 * saturating far from it. The sign always survives, so the cells that are in
 * are the model's exactly; 0 is out.
 */
export function quantizeLogit(logit: number): number {
	const q = Math.round(MASK_FIELD_MAX * Math.tanh(logit / LOGIT_SCALE));
	return logit > 0 ? Math.max(q, 1) : Math.min(q, 0);
}

/**
 * The logit each field byte stands for, indexed by the byte plus 127. A byte
 * of 0 is a hair below zero, so the edge between it and a byte of 1 falls
 * next to the 1, as the logits it came from had it.
 */
export const FIELD_LOGITS: Float32Array = Float32Array.from({ length: 2 * MASK_FIELD_MAX + 1 }, (_, i) => {
	const q = i - MASK_FIELD_MAX;
	if (q === 0) return -0.004;
	return LOGIT_SCALE * Math.atanh(Math.max(-0.9999, Math.min(0.9999, q / MASK_FIELD_MAX)));
});

/** A field of `cells` with nothing in it. */
export function emptyField(cells: number): Int8Array {
	return new Int8Array(cells).fill(-MASK_FIELD_MAX);
}

/**
 * A prompt on the footage, in 0..1 of its frame; label 1 marks the object, 0
 * marks background, and 2 and 3 are the corners of a box around it (see `Sam2Point`).
 */
export type MaskPoint = { x: number; y: number; label: 0 | 1 | 2 | 3 };

/**
 * A brush stroke over the prompted frame's mask: its points in 0..1 of the
 * frame, its radius in 0..1 of the frame's height; label 1 adds, 0 erases.
 */
export type MaskStroke = { label: 0 | 1; radius: number; points: { x: number; y: number }[] };

/**
 * How a mask's frames were made, enough to make them again: the object
 * prompted by `points` on `seedFrame` of the footage, its mask there
 * corrected by `strokes`, followed through every frame from `first` on — one
 * a frame of the file, at the file's rate.
 */
export interface MaskRecipe {
	/** The model that made the frames. */
	model: string;
	/** The content id of the footage the object was tracked on. */
	source: string;
	/** The source frame, at the file's rate, frame 0 of the file belongs to. */
	first: number;
	/** The source frame, at the file's rate, the points were placed on. */
	seedFrame: number;
	points: MaskPoint[];
	/** Painted over the model's mask of the seed frame, in order. */
	strokes?: MaskStroke[];
}

export interface MaskHeader {
	/** The field's grid: what every frame holds. */
	gridWidth: number;
	gridHeight: number;
	/** The frame the grid covers: the footage's, which the grid is stretched over. */
	width: number;
	height: number;
	frameRate: number;
	frameCount: number;
	recipe?: MaskRecipe;
}

/** One frame's segmentation: its field row-major, a byte a cell (see `quantizeLogit`); in where above zero. */
export type MaskFrame = {
	field: Int8Array;
	/** Whether the object is in frame: at or below zero the model saw it occluded. */
	score: number;
	/** The model's own estimate of the mask's quality, 0 to 1. */
	iou: number;
};

/** Whether `bytes` begin like a mask file. */
export function isMaskFileHead(bytes: Uint8Array): boolean {
	return MAGIC.every((byte, index) => bytes[index] === byte);
}

/** Writes a mask file: `frames[i]` is frame `i`, null where there is no mask. */
export function encodeMaskFile(header: Omit<MaskHeader, 'frameCount'>, frames: readonly (MaskFrame | null)[]): Blob {
	const full: MaskHeader = { ...header, frameCount: frames.length };
	const json = new TextEncoder().encode(JSON.stringify(full));
	const cells = header.gridWidth * header.gridHeight;

	const table = new DataView(new ArrayBuffer(frames.length * TABLE_ENTRY_BYTES));
	const runs = new RunWriter();
	for (let i = 0; i < frames.length; i++) {
		const frame = frames[i];
		const at = i * TABLE_ENTRY_BYTES;
		const offset = runs.length;
		if (frame) encodeRuns(frame.field, cells, runs);
		table.setUint32(at, offset, true);
		table.setUint32(at + 4, runs.length - offset, true);
		table.setFloat32(at + 8, frame?.score ?? 0, true);
		table.setFloat32(at + 12, frame?.iou ?? 0, true);
	}

	const preamble = new DataView(new ArrayBuffer(PREAMBLE_BYTES));
	MAGIC.forEach((byte, index) => preamble.setUint8(index, byte));
	preamble.setUint32(4, VERSION, true);
	preamble.setUint32(8, json.byteLength, true);

	return new Blob([preamble, json, table, runs.written()], { type: MASK_MIME_TYPE });
}

/** The header of a mask file, read without the frames. */
export async function readMaskHeader(blob: Blob): Promise<MaskHeader> {
	const preamble = new Uint8Array(await blob.slice(0, PREAMBLE_BYTES).arrayBuffer());
	const length = readPreamble(preamble);
	const json = await blob.slice(PREAMBLE_BYTES, PREAMBLE_BYTES + length).arrayBuffer();
	return parseHeader(json);
}

/** A mask file in memory, its frames decoded one at a time as they are asked for. */
export class MaskFile {
	public readonly header: MaskHeader;
	private readonly table: DataView;
	private readonly data: Uint8Array;

	private constructor(header: MaskHeader, table: DataView, data: Uint8Array) {
		this.header = header;
		this.table = table;
		this.data = data;
	}

	public static async read(blob: Blob): Promise<MaskFile> {
		const bytes = new Uint8Array(await blob.arrayBuffer());
		const length = readPreamble(bytes);
		const header = parseHeader(bytes.subarray(PREAMBLE_BYTES, PREAMBLE_BYTES + length));
		const tableStart = PREAMBLE_BYTES + length;
		const dataStart = tableStart + header.frameCount * TABLE_ENTRY_BYTES;
		if (bytes.byteLength < dataStart) throw new Error('The mask file is cut short');
		const table = new DataView(bytes.buffer, bytes.byteOffset + tableStart, dataStart - tableStart);
		return new MaskFile(header, table, bytes.subarray(dataStart));
	}

	public get frameCount(): number {
		return this.header.frameCount;
	}

	/** Whether frame `index` has a mask: in range, and tracked. */
	public has(index: number): boolean {
		return index >= 0 && index < this.frameCount && this.table.getUint32(index * TABLE_ENTRY_BYTES + 4, true) > 0;
	}

	public score(index: number): number {
		return this.table.getFloat32(index * TABLE_ENTRY_BYTES + 8, true);
	}

	public iou(index: number): number {
		return this.table.getFloat32(index * TABLE_ENTRY_BYTES + 12, true);
	}

	/**
	 * Decodes frame `index`'s field into `field`, a cell a byte. False, and
	 * nothing written, when the frame has no mask.
	 */
	public field(index: number, field: Int8Array): boolean {
		if (!this.has(index)) return false;
		const at = index * TABLE_ENTRY_BYTES;
		const offset = this.table.getUint32(at, true);
		const length = this.table.getUint32(at + 4, true);
		const size = Math.min(field.length, this.header.gridWidth * this.header.gridHeight);

		let cursor = offset;
		const end = offset + length;
		let position = 0;
		while (cursor < end && position < size) {
			let value = 0;
			let shift = 0;
			let byte: number;
			do {
				byte = this.data[cursor++]!;
				value += (byte & 0x7f) * 2 ** shift;
				shift += 7;
			} while (byte & 0x80 && cursor < end);
			const kind = value % 4;
			const stop = Math.min(size, position + Math.floor(value / 4));
			if (kind === RUN_LITERAL) {
				for (; position < stop && cursor < end; position++) field[position] = (this.data[cursor++]! << 24) >> 24;
			} else {
				field.fill(kind === RUN_IN ? MASK_FIELD_MAX : -MASK_FIELD_MAX, position, stop);
			}
			position = stop;
		}
		if (position < size) field.fill(-MASK_FIELD_MAX, position, size);
		return true;
	}
}

/** The header length a preamble gives, after checking it is one. */
function readPreamble(bytes: Uint8Array): number {
	if (bytes.byteLength < PREAMBLE_BYTES || !isMaskFileHead(bytes)) throw new Error('Not a mask file');
	const view = new DataView(bytes.buffer, bytes.byteOffset, PREAMBLE_BYTES);
	const version = view.getUint32(4, true);
	if (version !== VERSION) throw new Error(`Unsupported mask file version: ${version}`);
	return view.getUint32(8, true);
}

function parseHeader(json: ArrayBuffer | Uint8Array): MaskHeader {
	const header = JSON.parse(new TextDecoder().decode(json)) as MaskHeader;
	const counts = [header.gridWidth, header.gridHeight, header.width, header.height, header.frameCount];
	if (!counts.every((value) => Number.isInteger(value) && value >= 0) || !(header.frameRate > 0)) {
		throw new Error('The mask file header is malformed');
	}
	return header;
}

const RUN_OUT = 0;
const RUN_IN = 1;
const RUN_LITERAL = 2;

/** Appends the runs of the first `cells` of `field` to `out`: saturated stretches as runs, the rest written out. */
function encodeRuns(field: Int8Array, cells: number, out: RunWriter): void {
	for (let i = 0; i < cells;) {
		const value = field[i]!;
		let end = i + 1;
		if (value === MASK_FIELD_MAX || value === -MASK_FIELD_MAX) {
			while (end < cells && field[end] === value) end++;
			out.varint((end - i) * 4 + (value > 0 ? RUN_IN : RUN_OUT));
		} else {
			while (end < cells && Math.abs(field[end]!) !== MASK_FIELD_MAX) end++;
			out.varint((end - i) * 4 + RUN_LITERAL);
			out.bytes(field.subarray(i, end));
		}
		i = end;
	}
}

/** A growing byte buffer of varints. */
class RunWriter {
	private buffer: Uint8Array<ArrayBuffer> = new Uint8Array(64 * 1024);
	public length = 0;

	public varint(value: number): void {
		this.reserve(5);
		while (value >= 0x80) {
			this.buffer[this.length++] = (value & 0x7f) | 0x80;
			value = Math.floor(value / 0x80);
		}
		this.buffer[this.length++] = value;
	}

	/** Appends `values` as they are, a signed byte each. */
	public bytes(values: Int8Array): void {
		this.reserve(values.length);
		this.buffer.set(new Uint8Array(values.buffer, values.byteOffset, values.length), this.length);
		this.length += values.length;
	}

	public written(): Uint8Array<ArrayBuffer> {
		return this.buffer.subarray(0, this.length);
	}

	private reserve(bytes: number): void {
		if (this.length + bytes <= this.buffer.length) return;
		let size = this.buffer.length * 2;
		while (size < this.length + bytes) size *= 2;
		const grown = new Uint8Array(size);
		grown.set(this.buffer.subarray(0, this.length));
		this.buffer = grown;
	}
}
