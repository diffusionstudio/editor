/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { BYTES_PER_FLOAT, FEAT_TOKENS, HIDDEN_DIM, IMAGE_SIZE } from './constants';
import { PREPROCESS_SHADER, TRANSPOSE_SHADER, WORKGROUP_SIZE } from './shaders';

/** Degrees clockwise a decoded frame is turned for display. */
export type Rotation = 0 | 90 | 180 | 270;

export function createStorageBuffer(device: GPUDevice, size: number, label: string): GPUBuffer {
	return device.createBuffer({
		label,
		size,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
	});
}

function createPipeline(device: GPUDevice, code: string, label: string): GPUComputePipeline {
	return device.createComputePipeline({
		label,
		layout: 'auto',
		compute: { module: device.createShaderModule({ label, code }), entryPoint: 'main' },
	});
}

function dispatch(device: GPUDevice, pipeline: GPUComputePipeline, bindGroup: GPUBindGroup, x: number, y: number): void {
	const encoder = device.createCommandEncoder();
	const pass = encoder.beginComputePass();
	pass.setPipeline(pipeline);
	pass.setBindGroup(0, bindGroup);
	pass.dispatchWorkgroups(x, y);
	pass.end();
	device.queue.submit([encoder.finish()]);
}

const PARAMS_BYTES = 48;
const MAX_TAPS = 8;

/** Uploads a frame and turns it into the vision encoder's `pixel_values`. */
export class FramePreprocessor {
	readonly pixels: GPUBuffer;
	private readonly pipeline: GPUComputePipeline;
	private readonly sampler: GPUSampler;
	private readonly params: GPUBuffer;
	private texture: GPUTexture | null = null;

	constructor(
		private readonly device: GPUDevice,
		private readonly mean: readonly number[],
		private readonly std: readonly number[],
	) {
		this.pixels = createStorageBuffer(device, 3 * IMAGE_SIZE * IMAGE_SIZE * BYTES_PER_FLOAT, 'sam2 pixel_values');
		this.pipeline = createPipeline(device, PREPROCESS_SHADER, 'sam2 preprocess');
		this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
		this.params = device.createBuffer({
			label: 'sam2 preprocess params',
			size: PARAMS_BYTES,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
	}

	run(frame: VideoFrame, rotation: Rotation): void {
		const width = frame.displayWidth;
		const height = frame.displayHeight;
		const texture = this.textureFor(width, height);
		this.device.queue.copyExternalImageToTexture({ source: frame }, { texture }, [width, height]);

		const params = new ArrayBuffer(PARAMS_BYTES);
		const floats = new Float32Array(params);
		const uints = new Uint32Array(params);
		floats[0] = width;
		floats[1] = height;
		uints[2] = rotation / 90;
		uints[3] = Math.min(MAX_TAPS, Math.max(1, Math.ceil(Math.max(width, height) / IMAGE_SIZE)));
		floats.set(this.mean, 4);
		floats.set(this.std, 8);
		this.device.queue.writeBuffer(this.params, 0, params);

		const bindGroup = this.device.createBindGroup({
			layout: this.pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: this.params } },
				{ binding: 1, resource: texture.createView() },
				{ binding: 2, resource: this.sampler },
				{ binding: 3, resource: { buffer: this.pixels } },
			],
		});
		dispatch(this.device, this.pipeline, bindGroup, IMAGE_SIZE / WORKGROUP_SIZE, IMAGE_SIZE / WORKGROUP_SIZE);
	}

	private textureFor(width: number, height: number): GPUTexture {
		if (this.texture?.width === width && this.texture.height === height) return this.texture;

		this.texture?.destroy();
		this.texture = this.device.createTexture({
			label: 'sam2 frame',
			size: [width, height],
			format: 'rgba8unorm',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
		});
		return this.texture;
	}

	dispose(): void {
		this.texture?.destroy();
		this.pixels.destroy();
		this.params.destroy();
	}
}

/** Rewrites a [1, C, H, W] feature map as the [H*W, 1, C] tokens memory attention reads. */
export class TokenTransposer {
	private readonly pipeline: GPUComputePipeline;

	constructor(private readonly device: GPUDevice) {
		this.pipeline = createPipeline(device, TRANSPOSE_SHADER, 'sam2 transpose');
	}

	run(channels: GPUBuffer, tokens: GPUBuffer): void {
		const size = FEAT_TOKENS * HIDDEN_DIM * BYTES_PER_FLOAT;
		const bindGroup = this.device.createBindGroup({
			layout: this.pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: channels, size } },
				{ binding: 1, resource: { buffer: tokens, size } },
			],
		});
		dispatch(this.device, this.pipeline, bindGroup, FEAT_TOKENS / WORKGROUP_SIZE, HIDDEN_DIM / WORKGROUP_SIZE);
	}
}
