/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import * as ort from 'onnxruntime-web/webgpu';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';

export type Session = ort.InferenceSession;
export type Tensor = ort.Tensor;
export type Outputs = Awaited<ReturnType<Session['run']>>;

/** Points the runtime at its bundled wasm; it creates the GPU device itself when the first session is built. */
export function configureRuntime(): void {
	ort.env.wasm.wasmPaths = { wasm: wasmUrl };
	ort.env.webgpu.powerPreference = 'high-performance';
}

/** The device the runtime built its sessions on, which the pipeline's own passes share so buffers need no copies. */
export function runtimeDevice(): Promise<GPUDevice> {
	return ort.env.webgpu.device;
}

/** A WebGPU session whose listed outputs stay on the GPU; the rest are downloaded after each run. */
export function createSession(model: ArrayBuffer, gpuOutputs: readonly string[], options: Partial<ort.InferenceSession.SessionOptions> = {}): Promise<Session> {
	return ort.InferenceSession.create(model, {

		executionProviders: [{ name: 'webgpu' }],
		graphOptimizationLevel: 'all',
		preferredOutputLocation: Object.fromEntries(gpuOutputs.map((name) => [name, 'gpu-buffer' as const])),
		...options,
	});
}

export function gpuTensor(buffer: GPUBuffer, dims: number[]): Tensor {
	return ort.Tensor.fromGpuBuffer(buffer, { dataType: 'float32', dims });
}

export function floatTensor(data: ArrayLike<number>, dims: number[]): Tensor {
	return new ort.Tensor('float32', Float32Array.from(data), dims);
}

export function intTensor(data: ArrayLike<number>, dims: number[]): Tensor {
	return new ort.Tensor('int32', Int32Array.from(data), dims);
}

export function floats(outputs: Outputs, name: string): Float32Array {
	return outputs[name]!.data as Float32Array;
}

export function gpuBuffer(outputs: Outputs, name: string): GPUBuffer {
	return outputs[name]!.gpuBuffer;
}

/** Hands GPU-resident outputs back to the runtime's pool. */
export function disposeOutputs(outputs: Outputs): void {
	for (const tensor of Object.values(outputs)) {
		if (tensor.location === 'gpu-buffer') tensor.dispose();
	}
}
