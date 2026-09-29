/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { DEFAULT_SAM2_MODEL, MEMORY_FRAMES, sam2Model } from './constants';
import { readFloat16Initializer } from './onnx';
import { configureRuntime, createSession, runtimeDevice } from './sessions';
import { Sam2Video } from './tracker';
import { fetchModelFiles } from './weights';

import type { ModelConstants, Sam2Model, Sam2ModelId } from './constants';
import type { Session } from './sessions';

export type Sam2Progress =
	| { phase: 'download'; loaded: number; total: number }
	| { phase: 'compile' };

export type Sam2LoadOptions = {
	onProgress?: (progress: Sam2Progress) => void;
};

type Loading = {
	id: Sam2ModelId;
	model: Promise<Sam2Video>;
	listeners: Set<(progress: Sam2Progress) => void>;
	last: Sam2Progress | null;
	controller: AbortController;
	settled: boolean;
};

let loaded: Loading | null = null;

/**
 * A model, loaded once per page: the first call fetches and compiles it,
 * later calls for it share the result, and hear its progress from where it
 * stands. One model is loaded at a time, the large one being most of a
 * laptop GPU's memory: asking for another disposes the one before, so a
 * caller must be done with it first, and cancels it while it is still on
 * its way — the files it fetched whole stay cached, the rest are left.
 * A cancelled load rejects with an `AbortError`.
 */
export function loadSam2(id: Sam2ModelId = DEFAULT_SAM2_MODEL, { onProgress }: Sam2LoadOptions = {}): Promise<Sam2Video> {
	if (loaded?.id !== id) loaded = startLoad(id);
	if (onProgress) {
		loaded.listeners.add(onProgress);
		if (loaded.last) onProgress(loaded.last);
	}
	return loaded.model;
}

function startLoad(id: Sam2ModelId): Loading {
	const previous = loaded;
	if (previous && !previous.settled) previous.controller.abort(new DOMException(`${sam2Model(id).label} was asked for instead`, 'AbortError'));

	const controller = new AbortController();
	const report = (progress: Sam2Progress) => {
		entry.last = progress;
		for (const listener of entry.listeners) listener(progress);
	};
	const model = (async () => {
		await previous?.model.then((model) => model.dispose(), () => undefined);
		return load(sam2Model(id), report, controller.signal);
	})();

	const entry: Loading = {
		id,
		model: model
			.catch((error: unknown) => {
				if (loaded === entry) loaded = null;
				throw error;
			})
			.finally(() => {
				entry.settled = true;
				entry.listeners.clear();
			}),
		listeners: new Set(),
		last: null,
		controller,
		settled: false,
	};
	return entry;
}

async function load(model: Sam2Model, onProgress: (progress: Sam2Progress) => void, signal: AbortSignal): Promise<Sam2Video> {
	signal.throwIfAborted();
	if (!navigator.gpu) throw new Error('WebGPU is not available in this browser');
	configureRuntime();

	const files = await fetchModelFiles(model, (progress) => onProgress({ phase: 'download', ...progress }), signal);
	const constants = JSON.parse(new TextDecoder().decode(files.constants)) as ModelConstants;
	if (constants.image_size !== model.imageSize || constants.memory_frames !== MEMORY_FRAMES) {
		throw new Error(`The model is for ${constants.image_size}px and ${constants.memory_frames} memories, the pipeline for ${model.imageSize}px and ${MEMORY_FRAMES}`);
	}

	onProgress({ phase: 'compile' });
	// Compiling takes seconds and a share of the GPU: a model no longer
	// wanted stops at the next graph, and what it built is let go. The runtime
	// builds one WebGPU session at a time.
	const built: Session[] = [];
	const build = async (...args: Parameters<typeof createSession>) => {
		signal.throwIfAborted();
		const session = await createSession(...args);
		built.push(session);
		return session;
	};
	try {
		const visionEncoder = await build(files.visionEncoder, ['feats0', 'feats1', 'feats2', 'feats2_no_mem', 'vision_pos_embed'], { enableGraphCapture: true });
		const maskDecoder = await build(files.maskDecoder, ['high_res_mask', 'object_pointer']);
		const memoryEncoder = await build(files.memoryEncoder, ['memory_tokens', 'memory_pos']);
		const memoryAttention = await build(files.memoryAttention, ['conditioned_feats'], { enableGraphCapture: true });
		const pointerTpos = await build(files.pointerTpos, ['pointer_pos']);
		signal.throwIfAborted();
		const device = await runtimeDevice();

		const positions = readFloat16Initializer(files.visionEncoder, 'pos_embed');
		return new Sam2Video(model, device, { visionEncoder, maskDecoder, memoryEncoder, memoryAttention, pointerTpos }, constants, positions);
	} catch (error) {
		for (const session of built) void session.release();
		throw error;
	}
}
