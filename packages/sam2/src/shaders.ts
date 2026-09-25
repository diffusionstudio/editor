/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { FEAT_TOKENS, HIDDEN_DIM, IMAGE_SIZE } from './constants';

export const WORKGROUP_SIZE = 16;

/**
 * Resizes a video frame to the model's square input, applies the track's
 * display rotation, and normalizes into planar RGB floats. Frames larger than
 * the input are box-filtered with a few taps per output pixel so downscaling
 * does not alias.
 */
export const PREPROCESS_SHADER = /* wgsl */ `
struct Params {
	size: vec2f,
	rotation: u32,
	taps: u32,
	mean: vec3f,
	_pad0: f32,
	deviation: vec3f,
	_pad1: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var frame: texture_2d<f32>;
@group(0) @binding(2) var frameSampler: sampler;
@group(0) @binding(3) var<storage, read_write> pixels: array<f32>;

const SIZE: u32 = ${IMAGE_SIZE}u;
const PLANE: u32 = SIZE * SIZE;

fn toSource(uv: vec2f) -> vec2f {
	switch params.rotation {
		case 1u: { return vec2f(uv.y, 1.0 - uv.x); }
		case 2u: { return vec2f(1.0 - uv.x, 1.0 - uv.y); }
		case 3u: { return vec2f(1.0 - uv.y, uv.x); }
		default: { return uv; }
	}
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3u) {
	if (id.x >= SIZE || id.y >= SIZE) { return; }

	let taps = max(params.taps, 1u);
	var rgb = vec3f(0.0);
	for (var y = 0u; y < taps; y++) {
		for (var x = 0u; x < taps; x++) {
			let offset = (vec2f(f32(x), f32(y)) + 0.5) / f32(taps);
			let uv = (vec2f(id.xy) + offset) / f32(SIZE);
			rgb += textureSampleLevel(frame, frameSampler, toSource(uv), 0.0).rgb;
		}
	}
	rgb = (rgb / f32(taps * taps) - params.mean) / params.deviation;

	let index = id.y * SIZE + id.x;
	pixels[index] = rgb.r;
	pixels[PLANE + index] = rgb.g;
	pixels[2u * PLANE + index] = rgb.b;
}
`;

/** Turns a [C, H, W] feature map into the [H*W, C] token layout memory attention takes. */
export const TRANSPOSE_SHADER = /* wgsl */ `
@group(0) @binding(0) var<storage, read> channels: array<f32>;
@group(0) @binding(1) var<storage, read_write> tokens: array<f32>;

const CHANNELS: u32 = ${HIDDEN_DIM}u;
const TOKENS: u32 = ${FEAT_TOKENS}u;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3u) {
	let token = id.x;
	let channel = id.y;
	if (token >= TOKENS || channel >= CHANNELS) { return; }
	tokens[token * CHANNELS + channel] = channels[channel * TOKENS + token];
}
`;
