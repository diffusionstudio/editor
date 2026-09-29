/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Protobuf field numbers on the path to a stored tensor: ModelProto.graph, GraphProto.initializer, TensorProto.{data_type, name, raw_data}. */
const MODEL_GRAPH = 7;
const GRAPH_INITIALIZER = 5;
const TENSOR_DATA_TYPE = 2;
const TENSOR_NAME = 8;
const TENSOR_RAW_DATA = 9;
const FLOAT16 = 10;

const VARINT = 0;
const FIXED64 = 1;
const LENGTH_DELIMITED = 2;
const FIXED32 = 5;

type Field = { number: number; value: number; bytes: Uint8Array };

/**
 * Reads a float16 initializer out of a model's bytes, as float32: enough of
 * the protobuf to walk to it, and nothing else.
 */
export function readFloat16Initializer(model: ArrayBuffer, name: string): Float32Array {
	const graph = [...fields(new Uint8Array(model))].find((field) => field.number === MODEL_GRAPH);
	if (!graph) throw new Error('The model has no graph');

	for (const field of fields(graph.bytes)) {
		if (field.number !== GRAPH_INITIALIZER) continue;

		let tensorName = '';
		let dataType = 0;
		let raw: Uint8Array | null = null;
		for (const part of fields(field.bytes)) {
			if (part.number === TENSOR_NAME) tensorName = new TextDecoder().decode(part.bytes);
			else if (part.number === TENSOR_DATA_TYPE) dataType = part.value;
			else if (part.number === TENSOR_RAW_DATA) raw = part.bytes;
		}
		if (tensorName !== name) continue;
		if (dataType !== FLOAT16 || !raw) throw new Error(`The initializer ${name} is not stored as raw float16`);

		const halves = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
		const floats = new Float32Array(raw.byteLength / 2);
		for (let i = 0; i < floats.length; i++) floats[i] = halfToFloat(halves.getUint16(i * 2, true));
		return floats;
	}
	throw new Error(`The model has no initializer ${name}`);
}

function* fields(bytes: Uint8Array): Generator<Field> {
	let offset = 0;
	const varint = (): number => {
		let value = 0;
		let scale = 1;
		for (;;) {
			const byte = bytes[offset++]!;
			value += (byte & 0x7f) * scale;
			if (byte < 0x80) return value;
			scale *= 0x80;
		}
	};

	while (offset < bytes.length) {
		const key = varint();
		const number = Math.floor(key / 8);
		switch (key % 8) {
			case VARINT:
				yield { number, value: varint(), bytes: EMPTY };
				break;
			case FIXED64:
				offset += 8;
				break;
			case LENGTH_DELIMITED: {
				const length = varint();
				yield { number, value: length, bytes: bytes.subarray(offset, offset + length) };
				offset += length;
				break;
			}
			case FIXED32:
				offset += 4;
				break;
			default:
				throw new Error('The model is not a valid ONNX file');
		}
	}
}

const EMPTY = new Uint8Array(0);

function halfToFloat(half: number): number {
	const sign = half & 0x8000 ? -1 : 1;
	const exponent = (half >> 10) & 0x1f;
	const fraction = half & 0x3ff;
	if (exponent === 0) return sign * fraction * 2 ** -24;
	if (exponent === 0x1f) return fraction ? NaN : sign * Infinity;
	return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}
