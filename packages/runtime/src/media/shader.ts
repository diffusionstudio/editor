/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Shader, ShaderHostHandle } from "../traits";
import { parseColor } from "../utils/color";

import type { Entity, World } from "@diffusionstudio/koota";

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type UniformValue = number | number[] | string;

/**
 * Runtime pipeline for one shader paint: compiles the paint's fragment-stage
 * WGSL against the engine prelude, samples the media paint directly below the
 * shader in the fill stack into a texture, runs the pipeline into an
 * offscreen WebGPU canvas, and hands the result back to the Canvas2D
 * compositor via `drawImage`. Created lazily by `resolveShaderHost`, exactly
 * like the media decoders.
 *
 * The authored contract (see reference/jsx/shader-paint.md): the user writes
 * `@fragment fn main(@location(0) uv: vec2f) -> @location(0) vec4f` with `uv`
 * in box space, samples the media through `sampleSource(uv)` (which honors
 * the media paint's `objectFit` placement), and declares parameters as
 * `@group(1)` uniforms whose values arrive by name from the `uniforms` prop.
 */

// One device for every shader paint in the page; pipelines are per-host.
let devicePromise: Promise<GPUDevice | null> | null = null;

function sharedDevice(): Promise<GPUDevice | null> {
	devicePromise ??= (async () => {
		const adapter = await navigator.gpu?.requestAdapter();
		if (!adapter) {
			console.error("[shader-paint] WebGPU is not available; shader paints render as passthrough");
			return null;
		}
		return await adapter.requestDevice();
	})();
	return devicePromise;
}

const PRELUDE = /* wgsl */ `
struct Globals {
	resolution: vec2f,
	time: f32,
	_pad: f32,
	fitOffset: vec2f,
	fitSize: vec2f,
}

@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> globals: Globals;

struct VSOut {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VSOut {
	var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
	var out: VSOut;
	out.position = vec4f(corners[i], 0.0, 1.0);
	out.uv = vec2f((corners[i].x + 1.0) * 0.5, 1.0 - (corners[i].y + 1.0) * 0.5);
	return out;
}

// Samples the media in box space: uv spans the parent's box, the media sits
// within it per objectFit, and letterbox areas return transparent black.
fn sampleSource(uv: vec2f) -> vec4f {
	let suv = (uv - globals.fitOffset) / globals.fitSize;
	let inside = all(suv >= vec2f(0.0)) && all(suv <= vec2f(1.0));
	let color = textureSampleLevel(source, sourceSampler, clamp(suv, vec2f(0.0), vec2f(1.0)), 0.0);
	return select(vec4f(0.0), color, inside);
}
`;

const UNIFORM_COMPONENTS: Record<string, number> = {
	f32: 1,
	vec2f: 2, "vec2<f32>": 2,
	vec3f: 3, "vec3<f32>": 3,
	vec4f: 4, "vec4<f32>": 4,
};

const UNIFORM_RE = /@group\(1\)\s*@binding\((\d+)\)\s*var\s*<\s*uniform\s*>\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z0-9_]+(?:<[A-Za-z0-9_]+>)?)/g;

type UniformSlot = {
	name: string;
	binding: number;
	components: number;
	buffer: GPUBuffer;
};

type Pipeline = {
	device: GPUDevice;
	pipeline: GPURenderPipeline;
	sampler: GPUSampler;
	globals: GPUBuffer;
	slots: UniformSlot[];
	group1: GPUBindGroup;
	group0Layout: GPUBindGroupLayout;
};

export class ShaderHost {
	private canvas = new OffscreenCanvas(1, 1);
	private context: GPUCanvasContext | null = null;
	private gpu: Pipeline | null = null;
	private sourceTexture: GPUTexture | null = null;
	private group0: GPUBindGroup | null = null;
	private code = "";
	private generation = 0;
	private compilePromise: Promise<void> | null = null;
	private colorCache = new Map<string, number | null>();
	private disposed = false;

	/** Compiles when the code differs from the current pipeline's. */
	public setCode(code: string): void {
		if (this.disposed || code === this.code) return;
		this.code = code;
		const gen = ++this.generation;
		this.compilePromise = this.compile(code, gen).catch((error) => {
			if (gen === this.generation) this.gpu = null;
			console.error("[shader-paint]", error);
		});
	}

	/** Resolves once the current code has compiled (or failed). */
	public whenReady(): Promise<void> | null {
		return this.compilePromise;
	}

	/** True when a pipeline exists — callers fall back to drawing the media directly otherwise. */
	public get ready(): boolean {
		return this.gpu !== null && !this.disposed;
	}

	private async compile(code: string, gen: number): Promise<void> {
		const device = await sharedDevice();
		if (!device || this.disposed) return;

		const module = device.createShaderModule({ code: PRELUDE + code });
		const info = await module.getCompilationInfo();
		if (gen !== this.generation) return;

		const preludeLines = PRELUDE.split("\n").length;
		const errors = info.messages.filter((m) => m.type === "error");
		if (errors.length > 0) {
			this.gpu = null;
			const details = errors
				.map((m) => `${Math.max(1, m.lineNum - preludeLines + 1)}:${m.linePos} ${m.message}`)
				.join("\n");
			throw new Error(`WGSL compile failed:\n${details}`);
		}

		const group0Layout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
			],
		});

		// Declared @group(1) uniforms get one small buffer each, matched to the
		// `uniforms` record by name. An explicit layout keeps declared-but-unused
		// bindings valid (an "auto" layout would strip them).
		const slots: UniformSlot[] = [];
		for (const match of code.matchAll(UNIFORM_RE)) {
			const components = UNIFORM_COMPONENTS[match[3]];
			if (components === undefined) {
				console.warn(`[shader-paint] uniform \`${match[2]}\` has unsupported type ${match[3]} (use f32/vec2f/vec3f/vec4f)`);
				continue;
			}
			slots.push({
				name: match[2],
				binding: Number(match[1]),
				components,
				buffer: device.createBuffer({
					size: components * 4,
					usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
				}),
			});
		}

		const group1Layout = device.createBindGroupLayout({
			entries: slots.map((slot) => ({
				binding: slot.binding,
				visibility: GPUShaderStage.FRAGMENT,
				buffer: { type: "uniform" as const },
			})),
		});

		const pipeline = device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [group0Layout, group1Layout] }),
			vertex: { module, entryPoint: "vs" },
			fragment: {
				module,
				entryPoint: "main",
				targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
			},
		});
		if (gen !== this.generation || this.disposed) return;

		this.gpu = {
			device,
			pipeline,
			sampler: device.createSampler({ magFilter: "linear", minFilter: "linear" }),
			globals: device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
			slots,
			group1: device.createBindGroup({
				layout: group1Layout,
				entries: slots.map((slot) => ({ binding: slot.binding, resource: { buffer: slot.buffer } })),
			}),
			group0Layout,
		};
		// The source texture and its bind group belong to the old pipeline's layout.
		this.sourceTexture?.destroy();
		this.sourceTexture = null;
		this.group0 = null;
	}

	private writeUniforms(uniforms: Record<string, UniformValue> | null): void {
		const gpu = this.gpu!;
		for (const slot of gpu.slots) {
			const value = uniforms?.[slot.name];
			if (value === undefined) continue;
			const data = new Float32Array(slot.components);
			if (typeof value === "number") {
				data[0] = value;
			} else if (Array.isArray(value)) {
				for (let i = 0; i < Math.min(slot.components, value.length); i++) data[i] = value[i];
			} else {
				if (!this.colorCache.has(value)) this.colorCache.set(value, parseColor(value));
				const color = this.colorCache.get(value);
				if (color == null) continue;
				data[0] = ((color >> 16) & 0xff) / 255;
				if (slot.components >= 2) data[1] = ((color >> 8) & 0xff) / 255;
				if (slot.components >= 3) data[2] = (color & 0xff) / 255;
				if (slot.components >= 4) data[3] = 1;
			}
			gpu.device.queue.writeBuffer(slot.buffer, 0, data);
		}
	}

	/**
	 * Runs the shader over `source` and draws the result into the parent's
	 * box. `fit` is the media's drawImage placement within the box (from
	 * getScaledImageProps); `time` is the parent's local time in seconds.
	 * A null `source` runs the shader procedurally: the bound texture stays
	 * transparent black, so `sampleSource` returns vec4f(0) everywhere.
	 * Returns false when no pipeline is ready — the caller then draws the
	 * media directly instead.
	 */
	public draw(
		ctx: Ctx2D,
		width: number,
		height: number,
		source: GPUCopyExternalImageSource | null,
		sourceWidth: number,
		sourceHeight: number,
		fit: [dx: number, dy: number, sw: number, sh: number],
		time: number,
		uniforms: Record<string, UniformValue> | null,
	): boolean {
		const gpu = this.gpu;
		if (!gpu || this.disposed) return false;

		const w = Math.max(1, Math.round(width));
		const h = Math.max(1, Math.round(height));
		if (this.canvas.width !== w || this.canvas.height !== h) {
			this.canvas.width = w;
			this.canvas.height = h;
		}
		if (this.context === null) {
			this.context = this.canvas.getContext("webgpu");
			if (!this.context) return false;
			this.context.configure({
				device: gpu.device,
				format: navigator.gpu.getPreferredCanvasFormat(),
				alphaMode: "premultiplied",
			});
		}

		const sw = source ? Math.max(1, Math.round(sourceWidth)) : 1;
		const sh = source ? Math.max(1, Math.round(sourceHeight)) : 1;
		if (!this.sourceTexture || this.sourceTexture.width !== sw || this.sourceTexture.height !== sh || !this.group0) {
			this.sourceTexture?.destroy();
			this.sourceTexture = gpu.device.createTexture({
				size: [sw, sh],
				format: "rgba8unorm",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
			});
			this.group0 = gpu.device.createBindGroup({
				layout: gpu.group0Layout,
				entries: [
					{ binding: 0, resource: this.sourceTexture.createView() },
					{ binding: 1, resource: gpu.sampler },
					{ binding: 2, resource: { buffer: gpu.globals } },
				],
			});
		}

		if (source) {
			gpu.device.queue.copyExternalImageToTexture(
				{ source },
				{ texture: this.sourceTexture, premultipliedAlpha: true },
				[sw, sh],
			);
		}

		const [dx, dy, dw, dh] = fit;
		gpu.device.queue.writeBuffer(gpu.globals, 0, new Float32Array([
			w, h, time, 0,
			dx / w, dy / h, dw / w, dh / h,
		]));
		this.writeUniforms(uniforms);

		const encoder = gpu.device.createCommandEncoder();
		const pass = encoder.beginRenderPass({
			colorAttachments: [{
				view: this.context.getCurrentTexture().createView(),
				clearValue: { r: 0, g: 0, b: 0, a: 0 },
				loadOp: "clear",
				storeOp: "store",
			}],
		});
		pass.setPipeline(gpu.pipeline);
		pass.setBindGroup(0, this.group0);
		pass.setBindGroup(1, gpu.group1);
		pass.draw(3);
		pass.end();
		gpu.device.queue.submit([encoder.finish()]);

		ctx.drawImage(this.canvas, 0, 0, width, height);
		return true;
	}

	public dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.generation++;
		this.sourceTexture?.destroy();
		this.sourceTexture = null;
		if (this.gpu) {
			this.gpu.globals.destroy();
			for (const slot of this.gpu.slots) slot.buffer.destroy();
			this.gpu = null;
		}
		this.context?.unconfigure();
		this.canvas.width = 0;
		this.canvas.height = 0;
	}
}

/**
 * The shader paint's host, created lazily like the media decoders and kept in
 * sync with the persisted `Shader.code` component. Returns null until the
 * paint carries code.
 */
export function resolveShaderHost(_world: World, entity: Entity): ShaderHost | null {
	const code = entity.get(Shader)?.code;
	if (!code) return null;

	let host = entity.get(ShaderHostHandle) ?? null;
	if (!host) {
		host = new ShaderHost();
		entity.add(ShaderHostHandle);
		entity.set(ShaderHostHandle, host);
	}
	host.setCode(code);
	return host;
}
