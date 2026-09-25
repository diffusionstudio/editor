/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { configureRuntime, createSession, runtimeDevice } from './sessions';
import { Sam2Video } from './tracker';
import { fetchModelFiles } from './weights';

import type { ModelConstants } from './constants';

export type Sam2Progress =
	| { phase: 'download'; loaded: number; total: number }
	| { phase: 'compile' };

export type Sam2LoadOptions = {
	onProgress?: (progress: Sam2Progress) => void;
	signal?: AbortSignal;
};

let loading: Promise<Sam2Video> | null = null;

/** The model, loaded once per page: the first call fetches and compiles it, later calls share the result. */
export function loadSam2(options: Sam2LoadOptions = {}): Promise<Sam2Video> {
	loading ??= load(options).catch((error: unknown) => {
		loading = null;
		throw error;
	});
	return loading;
}

async function load({ onProgress, signal }: Sam2LoadOptions): Promise<Sam2Video> {
	if (!navigator.gpu) throw new Error('WebGPU is not available in this browser');
	configureRuntime();

	const files = await fetchModelFiles((progress) => onProgress?.({ phase: 'download', ...progress }), signal);
	const constants = JSON.parse(new TextDecoder().decode(files.constants)) as ModelConstants;

	onProgress?.({ phase: 'compile' });
	// The runtime builds one WebGPU session at a time.
	const visionEncoder = await createSession(files.visionEncoder, ['feats0', 'feats1', 'feats2', 'feats2_no_mem', 'vision_pos_embed']);
	const maskDecoder = await createSession(files.maskDecoder, ['high_res_mask', 'object_pointer']);
	const memoryEncoder = await createSession(files.memoryEncoder, ['memory_tokens', 'memory_pos']);
	const memoryAttention = await createSession(files.memoryAttention, ['conditioned_feats']);
	const pointerTpos = await createSession(files.pointerTpos, ['pointer_pos']);
	const device = await runtimeDevice();

	return new Sam2Video(device, { visionEncoder, maskDecoder, memoryEncoder, memoryAttention, pointerTpos }, constants);
}
