/* Redraw on a <surface>: the "hello" write-on stroke from redraw's docs.
 *
 * Redraw (redraw.dev) is a 2D renderer on WebGPU: a Library declares custom
 * GPU functions once, and a Canvas spawned from it is an immediate-mode
 * recorder — each frame re-records the scene and render() draws it. The scene
 * is the docs' Hello World (redraw.dev/docs/hello-world): a gradient flowing
 * along a handwritten "hello" path and a tapered stroke width, both written
 * in TypeScript (`'use gpu'`, compiled to WGSL by TypeGPU's babel plugin —
 * the same setup as 10-typegpu.tsx).
 *
 * Redraw is in technical preview: its packages install as .tgz tarballs from
 * a vendors/ folder in the project, per redraw.dev/docs/installation — grab
 * them from the GitHub release. TypeGPU is pinned to redraw's own lockfile
 * versions (the plugin's loose `tinyest` range resolves to a newer build
 * missing FORMAT_VERSION, which fails the compile — hence the overrides):
 *
 *   cp examples/11-redraw.tsx ~/Projects/hello-redraw/index.tsx
 *   cd ~/Projects/hello-redraw
 *   mkdir vendors            # drop redraw-<version>.tgz from the release here
 *   npm pkg set overrides.tinyest=0.3.1 overrides.tinyest-for-wgsl=0.3.2
 *   npm i ./vendors/redraw-1.3.0.tgz typegpu@0.11.3
 *   npm i -D unplugin-typegpu@0.11.3
 *   echo '{ "plugins": ["unplugin-typegpu/babel"] }' > babel.config.json
 *   dapi open ~/Projects/hello-redraw
 *
 * Redraw's pipeline renders into a storage texture, so the surface's
 * swapchain is configured rgba8unorm + STORAGE_BINDING (always
 * storage-bindable, unlike bgra8unorm). Device lifecycle mirrors
 * 07-webgpu.tsx: setup is async and held so exports wait for the pipeline,
 * a signal wakes the draw effect once it exists, and composition time is the
 * only clock — the docs scene works in milliseconds, so the playhead is
 * scaled by 1000 on the way in. Fails with a console error where WebGPU is
 * unavailable.
 *
 * The <surface> spans exactly one write-hold-unwrite cycle (start 0 →
 * end={period}). Period, stroke width, palette speed, and the background are
 * `@inspect` variables (see 09-inspect-variables.tsx): sidebar controls whose
 * reads in the draw closure are reactive, so moving one re-records the frame.
 *
 * The bitmap adapts to the output through `useResolution` (see
 * reference/jsx/lifecycle.md): the display's pixel ratio live, the export
 * scale offline. The surface bitmap is oversized by the factor and the
 * recording draws in composition pixels through canvas.scale(k) — redraw's
 * own dpr pattern — so the stroke stays sharp at any export resolution
 * instead of upscaling a composition-size bitmap.
 */

import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { useResolution, useTicker } from "@diffusionstudio/jsx";
import {
  Color,
  Paint,
  capWidth,
  createColor,
  createLibrary,
  createStrokeWidth,
  deflate,
  fitPath,
} from "redraw";
import { d, std } from "typegpu";
import type { SceneNode } from "@diffusionstudio/jsx";

// The handwritten "hello" script from the docs, as SVG path data.
const helloPath =
  "M13.6 247.8C13.6 247.8 51.8 206.1 84.2 168.8 140.8 103.4 202.8 27.1 150.1 14.3 131 9.7 116.4 29.3 107.3 44.8 69.7 108.4 58 213.8 57.5 302M58 302C67.7 271.3 104.4 190.3 140.2 192.5 181.5 195.1 145.3 257 154.5 283.8 168.8 321.6 208.2 292.3 230 276.9 265.9 251.5 289 230.7 289 199.9 289 161 235.3 173.5 223.3 204.6 213.9 228.9 214.3 265.3 229.3 283.6 247.5 305.7 287.7 309.4 312.2 287.9 337 266.2 354.7 234 368.7 212.5 403.9 158.3 464.4 85.6 449.1 29.5 447 21.9 440.4 16 432.5 15.7 393.6 14.2 381.8 98.6 375.3 128.8 368.8 159.3 345.2 260.8 373.1 292.5 404.4 328 446.3 261.9 464.7 231.1 468.7 224.8 472.6 217.9 476.1 212.5 511.3 158.4 571.8 85.6 556.5 29.5 554.4 21.9 547.8 16.1 539.9 15.8 501 14.2 489.2 98.7 482.8 128.8 476.2 159.3 452.6 260.8 480.5 292.6 511.8 328.1 562.4 265 572.6 232.3 587.3 185.4 620.9 171 660.9 179.7M660.9 179.7C616 166.1 580.9 199.1 572.6 232.6 566.8 256.4 573.5 281.6 599.2 295.2 668.5 331.9 742.8 211.1 660.9 179.7ZM660.9 179.7C643.7 181.3 636.1 204.2 643.3 227.2 654.3 263.4 704.3 267.7 733.1 255.5";

// A gradient along the path, written in TypeScript: TypeGPU compiles the
// "use gpu" callback to WGSL. The defaults object types `props` and becomes
// the GPU-side props struct; `ctx.t` carries the along-path position.
const PathGradient = createColor(
  (ctx, _tctx, _paint, props) => {
    "use gpu";
    const colors = [
      Color("#3FCEBC"), Color("#3CBCEB"), Color("#5F96E7"),
      Color("#816FE3"), Color("#9F5EE2"), Color("#DE589F"),
      Color("#FF645E"), Color("#FDA859"), Color("#FAEC54"),
      Color("#9EE671"), Color("#41E08D"),
    ];
    const pos = std.fract(ctx.t + props.shift) * 10;
    const i = d.u32(std.floor(pos));
    const f = std.fract(pos);
    const rgb = std.mix(colors[std.min(i, 10)], colors[std.min(i + 1, 10)], f);
    return rgb.rgba;
  },
  { shift: 0 },
);

// The stroke width, also in TypeScript: the callback returns the width and
// the pipeline bands the path SDF with it. `maxStrokeWidth` declares the
// widest width the callback can return, so tile binning never culls the band.
const HelloStroke = createStrokeWidth(
  (_ctx, _tctx, props) => {
    "use gpu";
    return props.width;
  },
  { width: 0 },
  { maxStrokeWidth: 40 },
);

// Boomerang 0→1→0 over `periodMs` milliseconds.
const boomerang = (time: number, periodMs: number) => {
  const phase = (time % periodMs) / periodMs;
  return phase < 0.5 ? phase * 2 : 2 - phase * 2;
};

// One write-hold-unwrite cycle in seconds; also the surface's duration.
/** @inspect number path="Hello/Period" min=2 max=16 step=0.5 */
const period = 8;

/** @inspect number path="Hello/Stroke Width" min=4 max=40 step=1 */
const strokeWidth = 25;

// Palette cycles per second.
/** @inspect number path="Hello/Palette Speed" min=0 max=1 step=0.05 */
const paletteSpeed = 0.2;

/** @inspect color path="Hello/Background" */
const background = "#ffffff";

type Gpu = {
  destroy: () => void;
  draw: (timeMs: number, k: number) => void;
};

export default function RedrawHello() {
  const { time, hold } = useTicker();
  const resolution = useResolution();
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
    context.configure({
      device,
      format: "rgba8unorm",
      usage: GPUTextureUsage.STORAGE_BINDING,
      alphaMode: "premultiplied",
    });

    // Declare the vocabulary. drawPath records one command per segment
    // group per tile; the stroke crosses itself, so give headroom over the
    // default 32.
    const lib = createLibrary(device, [PathGradient, HelloStroke], {
      maxCommandsPerTile: 64,
    });

    // The composition-pixel box: the bitmap is oversized from it by the
    // resolution factor, and the recording draws in composition pixels
    // through canvas.scale(k) — the redraw docs' dpr pattern.
    const { width, height } = el;
    const pathGeo = fitPath(
      helloPath,
      capWidth(deflate({ width, height }, 30), 800),
    );

    // The canvas binds to the swapchain texture's size, so a bitmap resize
    // (the export scale arriving, a pixel-ratio change) re-makes it.
    let canvas = lib.makeCanvas(context.getCurrentTexture());
    let bitmapK = 1;

    setGpu({
      destroy: () => {
        lib.dispose();
        device.destroy();
      },
      draw: (timeMs, k) => {
        if (k !== bitmapK) {
          bitmapK = k;
          el.width = Math.round(width * k);
          el.height = Math.round(height * k);
          canvas = lib.makeCanvas(context.getCurrentTexture());
        }
        // Draw in composition pixels; the scale maps them to the bitmap.
        // render() resets the recorder, so it is re-applied every frame.
        canvas.scale(k);
        // The inspect reads live here, so moving a control re-records.
        canvas.fill(new Paint().setColor(background));
        const t = boomerang(timeMs, period * 1000);
        const progress = Math.min(t * 3, 1);
        if (progress > 0.001) {
          const paint = new Paint()
            .addShader(PathGradient, { shift: (timeMs / 1000) * paletteSpeed })
            .setStroke(HelloStroke, { width: strokeWidth });
          canvas.drawPath(pathGeo.segment(0, progress), paint);
        }
        // The swapchain texture is new every frame, but its size and format
        // stay the same between resizes; hand the current one to render().
        canvas.render(context.getCurrentTexture());
      },
    });
  };

  // Held, so the frames wait for the pipeline instead of being sampled empty.
  onMount(() => hold(setup()));

  createEffect(() => {
    const g = gpu();
    const t = time();
    const k = resolution();
    if (!g) return;
    g.draw(t * 1000, k);
  });

  onCleanup(() => gpu()?.destroy());

  return (
    <stage camera={[0.6, 0, 0, 0.6, 85, 150]}>
      <scene name="Redraw hello" width={960} height={540} fill="white" active>
        <surface
          x={0}
          y={0}
          width={960}
          height={540}
          start={0}
          end={period}
          ref={surfaceRef}
        />
      </scene>
    </stage>
  );
}
