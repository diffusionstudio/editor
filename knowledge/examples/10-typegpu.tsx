/* TypeGPU on a <surface>: an underwater caustics shader written in TypeScript.
 *
 * The shader is TypeGPU's caustics example (docs.swmansion.com/TypeGPU,
 * MIT © Software Mansion) — one triangle whose fragment shader layers perlin
 * caustics, fog, and god rays — with its requestAnimationFrame clock swapped
 * for composition time, so scrubbing and exports stay frame-accurate.
 *
 * TypeGPU turns the `'use gpu'` functions below into WGSL at compile time,
 * which needs its babel plugin in the project's babel config (see
 * reference/jsx/module.md, "Compile-time plugins"):
 *
 *   cp examples/10-typegpu.tsx ~/Projects/caustics/index.tsx
 *   cd ~/Projects/caustics
 *   npm i typegpu @typegpu/noise && npm i -D unplugin-typegpu
 *   echo '{ "plugins": ["unplugin-typegpu/babel"] }' > babel.config.json
 *   dapi open ~/Projects/caustics
 *
 * Device lifecycle mirrors 07-webgpu.tsx: setup is async and held so exports
 * wait for the pipeline, a signal wakes the draw effect once it exists, and
 * composition time is the only clock. Tile density, speed, and the water
 * colors are `@inspect` variables (see 09-inspect-variables.tsx): sidebar
 * controls whose reads in the draw effect are reactive, reaching the shader
 * as uniforms. Vector math is spelled with std.mul /
 * std.add — the operator forms (`a * b`) run fine through the plugin but only
 * typecheck with TypeGPU's `tsover` TypeScript replacement.
 * Fails with a console error where WebGPU is unavailable.
 */

import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { useTicker } from "@diffusionstudio/jsx";
import { tgpu, d, std } from "typegpu";
import { perlin3d } from "@typegpu/noise";
import type { SceneNode } from "@diffusionstudio/jsx";

const mainVertex = tgpu.vertexFn({
  in: { vertexIndex: d.builtin.vertexIndex },
  out: { pos: d.builtin.position, uv: d.vec2f },
})(({ vertexIndex }) => {
  const pos = [d.vec2f(0, 0.8), d.vec2f(-0.8, -0.8), d.vec2f(0.8, -0.8)];
  const uv = [d.vec2f(0.5, 1), d.vec2f(0, 0), d.vec2f(1, 0)];

  return {
    pos: d.vec4f(pos[vertexIndex], 0, 1),
    uv: uv[vertexIndex],
  };
});

/** Grayscale floor tile pattern at a coordinate. */
const tilePattern = (uv: d.v2f): number => {
  "use gpu";
  const tiledUv = std.fract(uv);
  const proximity = std.abs(std.sub(std.mul(2, tiledUv), d.vec2f(1)));
  const maxProximity = std.max(proximity.x, proximity.y);
  return std.saturate((1 - maxProximity) ** 0.6 * 5);
};

const caustics = (uv: d.v2f, time: number, profile: d.v3f): d.v3f => {
  "use gpu";
  const distortion = perlin3d.sample(d.vec3f(std.mul(0.5, uv), time * 0.2));
  const distortedUv = std.add(uv, d.vec2f(distortion));
  const noise = std.abs(perlin3d.sample(d.vec3f(std.mul(5, distortedUv), time)));
  return std.pow(d.vec3f(1 - noise), profile);
};

/** Rotation by `angle` in the XY plane. */
const rotateXY = (angle: number): d.m2x2f => {
  "use gpu";
  return d.mat2x2f(
    /* right */ d.vec2f(std.cos(angle), std.sin(angle)),
    /* up    */ d.vec2f(-std.sin(angle), std.cos(angle)),
  );
};

/** Skew angle of the pool floor. */
const angle = 0.2;

/** @inspect number path="Caustics/Tile Density" min=5 max=20 step=1 */
const tileDensity = 10;

/** @inspect number path="Caustics/Speed" min=0 max=3 step=0.1 */
const speed = 1;

/** @inspect color path="Caustics/Fog Color" */
const fogColor = "#0d33b3";

/** @inspect color path="Caustics/Ambient Light" */
const ambientColor = "#3380ff";

/** A hex color as the vec3 the shader mixes with. */
const hexToVec3 = (hex: string): d.v3f =>
  d.vec3f(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  );

type Gpu = {
  destroy: () => void;
  draw: (time: number, density: number, fog: d.v3f, ambient: d.v3f) => void;
};

export default function TypegpuCaustics() {
  const { time, hold } = useTicker();
  const [gpu, setGpu] = createSignal<Gpu>();

  let surfaceRef: SceneNode | undefined;

  const setup = async () => {
    const el = surfaceRef!.element;
    if (!el) return;

    const root = await tgpu.init();
    const context = root.configureContext({ canvas: el, alphaMode: "premultiplied" });

    /** Composition time in seconds. */
    const timeU = root.createUniform(d.f32);
    const tileDensityU = root.createUniform(d.f32);
    const fogColorU = root.createUniform(d.vec3f);
    const ambientColorU = root.createUniform(d.vec3f);

    const mainFragment = tgpu.fragmentFn({
      in: { uv: d.vec2f },
      out: d.vec4f,
    })(({ uv }) => {
      "use gpu";
      // Skews the perspective a bit when applied to UV coordinates.
      const skewMat = d.mat2x2f(
        d.vec2f(std.cos(angle), std.sin(angle)),
        d.vec2f(-std.sin(angle) * 10 + uv.x * 3, std.cos(angle) * 5),
      );
      const skewedUv = std.mul(skewMat, uv);
      const tile = tilePattern(std.mul(tileDensityU.$, skewedUv));
      const albedo = std.mix(d.vec3f(0.1), d.vec3f(1), tile);

      // Transforming coordinates to simulate perspective squash.
      const cuv = d.vec2f(
        uv.x * (std.pow(uv.y * 1.5, 3) + 0.1) * 5,
        std.pow((uv.y * 1.5 + 0.1) * 1.5, 3),
      );
      // Two layers of caustics (large scale and small scale), tinted.
      const c1 = std.mul(caustics(cuv, timeU.$ * 0.2, d.vec3f(4, 4, 1)), d.vec3f(0.4, 0.65, 1));
      const c2 = std.mul(caustics(std.mul(2, cuv), timeU.$ * 0.4, d.vec3f(16, 1, 4)), d.vec3f(0.18, 0.3, 0.5));

      // A smooth blending factor, so caustics only appear at certain spots.
      const blendCoord = d.vec3f(std.mul(uv, d.vec2f(5, 10)), timeU.$ * 0.2 + 5);
      const blend = std.saturate(perlin3d.sample(blendCoord) + 0.3);

      const noFogColor = std.mul(albedo, std.mix(ambientColorU.$, std.add(c1, c2), blend));
      // Fog blending factor, based on the height of the pixels.
      const fog = std.min(uv.y ** 0.5 * 1.2, 1);

      const godRayUv = std.mul(std.mul(rotateXY(-0.3), uv), d.vec2f(15, 3));
      const godRay1 = std.mul(
        (perlin3d.sample(d.vec3f(godRayUv, timeU.$ * 0.5)) + 1) * uv.y,
        d.vec3f(0.18, 0.3, 0.5),
      );
      const godRay2 = std.mul(
        (perlin3d.sample(d.vec3f(std.mul(2, godRayUv), timeU.$ * 0.3)) + 1) * uv.y * 0.4,
        d.vec3f(0.18, 0.3, 0.5),
      );
      const godRays = std.add(godRay1, godRay2);

      return d.vec4f(std.add(std.mix(noFogColor, fogColorU.$, fog), godRays), 1);
    });

    const pipeline = root.createRenderPipeline({
      vertex: mainVertex,
      fragment: mainFragment,
    });

    setGpu({
      destroy: () => root.destroy(),
      draw: (t, density, fog, ambient) => {
        timeU.write(t);
        tileDensityU.write(density);
        fogColorU.write(fog);
        ambientColorU.write(ambient);
        pipeline.withColorAttachment({ view: context }).draw(3);
      },
    });
  };

  // Held, so the frames wait for the pipeline instead of being sampled empty.
  onMount(() => hold(setup()));

  // The inspect reads live here, so moving a control re-runs the draw.
  createEffect(() => {
    const g = gpu();
    const t = time();
    if (!g) return;
    g.draw(t * speed, tileDensity, hexToVec3(fogColor), hexToVec3(ambientColor));
  });

  onCleanup(() => gpu()?.destroy());

  return (
    <stage camera={[0.6, 0, 0, 0.6, 85, 150]}>
      <scene name="TypeGPU caustics" width={960} height={540} fill="#0b0d12" active>
        <surface x={0} y={0} width={960} height={540} ref={surfaceRef} />
      </scene>
    </stage>
  );
}
