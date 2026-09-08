/* WebGPU owning a <surface>: a triangle whose colors cycle with the playhead.
 *
 *   cp examples/07-webgpu.tsx ~/Projects/webgpu/index.tsx
 *   dapi open ~/Projects/webgpu
 *
 * `ref={surfaceRef}` assigns the surface's node, whose `element` is its
 * detached canvas; onMount a WebGPU context takes it over, and the engine
 * samples the bitmap into the node's box every frame. Device setup is async,
 * so the draw effect is created synchronously in the component body and a
 * signal wakes it once the pipeline exists — and `hold` keeps an export from
 * writing the frames that setup hasn't finished for, since a capture or an
 * export mounts the module again and sets up a device of its own.
 * Composition time feeds a uniform and the fragment shader derives the colors
 * from it (a phase-shifted cosine palette), so the playhead is the only
 * clock: scrubbing and exports stay frame-accurate.
 * Fails with a console error where WebGPU is unavailable.
 */

import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { useTicker } from "@diffusionstudio/jsx";
import type { SceneNode } from "@diffusionstudio/jsx";

const SHADER = /* wgsl */ `
  @group(0) @binding(0) var<uniform> time: f32;

  struct VSOut {
    @builtin(position) position: vec4f,
    @location(0) local: vec2f,
  }

  @vertex
  fn vs(@builtin(vertex_index) i: u32) -> VSOut {
    var corners = array<vec2f, 3>(vec2f(0.0, 0.75), vec2f(-0.8, -0.6), vec2f(0.8, -0.6));
    var out: VSOut;
    out.position = vec4f(corners[i], 0.0, 1.0);
    out.local = corners[i];
    return out;
  }

  @fragment
  fn fs(in: VSOut) -> @location(0) vec4f {
    // cosine palette; each corner leads the cycle by a different phase
    let phase = in.local.x * 1.5 + in.local.y;
    let rgb = 0.5 + 0.5 * cos(time + phase + vec3f(0.0, 2.094, 4.188));
    return vec4f(rgb, 1.0);
  }
`;

type Gpu = {
  device: GPUDevice;
  context: GPUCanvasContext;
  pipeline: GPURenderPipeline;
  uniforms: GPUBuffer;
  bindGroup: GPUBindGroup;
};

export default function WebgpuTriangle() {
  const { time, hold } = useTicker();
  const [gpu, setGpu] = createSignal<Gpu>();

  let surfaceRef: SceneNode | undefined;

  const setup = async () => {
    const el = surfaceRef!.element;
    if (!el) return;

    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) throw new Error("WebGPU is not available");
    const device = await adapter.requestDevice();

    const context = el.getContext("webgpu");
    if (!context) throw new Error("No webgpu context on the surface canvas");
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "premultiplied" });

    const module = device.createShaderModule({ code: SHADER });
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
    });

    const uniforms = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniforms } }],
    });

    setGpu({ device, context, pipeline, uniforms, bindGroup });
  };

  // Held, so the frames wait for the pipeline instead of being sampled empty.
  onMount(() => hold(setup()));

  createEffect(() => {
    const g = gpu();
    const t = time();
    if (!g) return;

    g.device.queue.writeBuffer(g.uniforms, 0, new Float32Array([t]));

    const encoder = g.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: g.context.getCurrentTexture().createView(),
          clearValue: { r: 0.04, g: 0.05, b: 0.08, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(g.pipeline);
    pass.setBindGroup(0, g.bindGroup);
    pass.draw(3);
    pass.end();
    g.device.queue.submit([encoder.finish()]);
  });

  onCleanup(() => gpu()?.device.destroy());

  return (
    <stage camera={[0.6, 0, 0, 0.6, 85, 150]}>
      <scene name="WebGPU triangle" width={960} height={540} fill="#0b0d12" active>
        <surface x={0} y={0} width={960} height={540} ref={surfaceRef} />
      </scene>
    </stage>
  );
}
