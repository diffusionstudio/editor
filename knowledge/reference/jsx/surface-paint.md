# `<surface>`

An element backed by a **canvas you draw yourself**. The `ref` receives the element's `SceneNode`, whose `element` is that canvas; draw into it with any context type — 2d, webgl, webgpu — and the engine samples the bitmap every frame, stretching it into the parent geometry's box. Use it for procedural graphics and for external renderers (three.js, p5, chart libraries) that want to own a canvas.

```tsx
let surfaceRef: SceneNode | undefined;

onMount(() => {
  const el = surfaceRef!.element!;
  const ctx = el.getContext("2d")!;
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, el.width, el.height);
  ctx.strokeStyle = "#7c9cff";
  ctx.lineWidth = 6;
  ctx.strokeRect(40, 40, el.width - 80, el.height - 80);
});

<surface x={40} y={40} width={640} height={360} cornerRadius={24} ref={surfaceRef} />
```

`<surfacePaint ref={...}>` is the paint child form, valid inside any filled visual element; `<surface>` is a rectangle carrying one, with all [common props](./elements.md#common-props).

## The ref and the canvas

```ts
import type { SceneNode } from "@diffusionstudio/jsx";
// { readonly element: HTMLCanvasElement | null, tag, props, parent, children }
```

- The ref receives the element's **`SceneNode`**, as every ref does. `element` is the paint's backing canvas: on the geometry for a `<surface>` (whose surface is its intrinsic paint), on the paint sub-entity for a `<surfacePaint>`; null where the host has no DOM.
- **Both SolidJS ref forms work.** The variable form `let surfaceRef: SceneNode | undefined;` + `ref={surfaceRef}` assigns the node when the element is created — read it in `onMount` or an effect, which run after the (synchronous) mount. The callback form `ref={(surface) => …}` runs **once**, when the element is created, inside the mount's reactive owner — `createEffect`, `onCleanup`, and [`useTicker`](./lifecycle.md#useticker) all work inside it.
- The canvas is allocated with the element and **sized to the holder's `width`/`height`** in composition pixels. A same-size set is a no-op, so a `renderer.setSize` of your own is not clobbered; resize the bitmap yourself for higher resolution, since it is stretched into the box every frame either way, and an animated box scales pixels rather than re-rasterizing. To follow the display's pixel ratio and the export scale, size it by [`useResolution`](#adapting-to-the-output-resolution).
- Unlike [`<html>`](./html.md) no flagged browser API is needed, and the sampled pixels render in exports.

## Reactivity

The engine samples the canvas every frame, so anything you draw shows up on the next frame. A mount stays live, so the reactive graph keeps running: redraw from signals inside effects, or drive frame-accurate motion from the ticker's composition time:

```tsx
const { time } = useTicker();
let surfaceRef: SceneNode | undefined;

createEffect(() => {
  const ctx = surfaceRef!.element!.getContext("2d")!;
  ctx.clearRect(0, 0, 400, 400);
  ctx.beginPath();
  ctx.arc(200, 200, 60 + 40 * Math.sin(time() * Math.PI), 0, Math.PI * 2);
  ctx.fillStyle = "#44dd88";
  ctx.fill();
});

<surface width={400} height={400} ref={surfaceRef} />
```

Because the ticker follows the playhead, ticker-driven drawing stays frame-accurate in exports too; wall-clock timers (`setInterval`, `requestAnimationFrame`) render live but ignore the playhead.

## External renderers

Anything that accepts an existing canvas plugs in directly; a detached canvas is fine for WebGL:

```tsx
const { time } = useTicker();
let surfaceRef: SceneNode | undefined;

onMount(() => {
  const el = surfaceRef!.element!;
  const renderer = new THREE.WebGLRenderer({
    canvas: el,
    preserveDrawingBuffer: true,
    alpha: true,
  });
  renderer.setSize(el.width, el.height, false);
  createEffect(() => {
    mesh.rotation.y = time() * 0.5;
    renderer.render(scene, camera);
  });
  onCleanup(() => renderer.dispose());
});

<surface width={1280} height={720} ref={surfaceRef} />
```

- **`preserveDrawingBuffer: true` is effectively required for WebGL** — by default the drawing buffer may be cleared after presentation, so the engine's per-frame sample can read back blank.
- `renderer.setSize(w, h, false)` resizes the bitmap through three.js; the third argument skips CSS sizing, which is meaningless on a detached canvas.
- Browsers cap live WebGL contexts per page (typically ~16, oldest evicted). One renderer is fine; don't give each of many paints its own GL context — share one renderer and copy frames out via `ImageBitmap` if you need many.

## Adapting to the output resolution

The bitmap is sampled in composition pixels, but the frame around it may rasterize denser: the live canvas draws at the display's pixel ratio, and an export's `resolution` setting scales the whole scene — a 960×540 surface in a 1080p export is a 2× upscale of the bitmap, and looks like one. Vector elements never notice (they rasterize through the scale); a surface holds pixels, so it has to provide them.

[`useResolution`](./lifecycle.md#useresolution) is that scale, as a reactive accessor. Oversize the bitmap by it and draw at the same density, and the sample lands pixel for pixel in the output:

```tsx
const { time } = useTicker();
const resolution = useResolution();
let surfaceRef: SceneNode | undefined;

createEffect(() => {
  const el = surfaceRef!.element!;
  const k = resolution();
  // A same-size set is a no-op; a real change also resets the context state.
  el.width = 400 * k;
  el.height = 400 * k;
  const ctx = el.getContext("2d")!;
  ctx.setTransform(k, 0, 0, k, 0, 0); // keep drawing in composition pixels
  ctx.clearRect(0, 0, 400, 400);
  ctx.beginPath();
  ctx.arc(200, 200, 60 + 40 * Math.sin(time() * Math.PI), 0, Math.PI * 2);
  ctx.fillStyle = "#44dd88";
  ctx.fill();
});

<surface width={400} height={400} ref={surfaceRef} />
```

Read the accessor **inside the effect that sizes and draws**: an export mounts the module before it configures its scale, so the first value is `1` and the correction arrives reactively before the first frame is sampled — a read at mount would miss it. For an external renderer the resize goes through its own API instead (`renderer.setSize(w * k, h * k, false)` for three.js, and a camera or transform keeping scene units in composition pixels); a WebGPU surface re-acquires its swapchain-bound resources after resizing, since the canvas texture changes size. Live, this also means retina-sharp previews — the cost is a bitmap `k²` the area, so a surface that should stay cheap can ignore the accessor and keep composition-size pixels.

## Props

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `ref` | `SceneNode` variable or `(surface: SceneNode) => void` | none | The [common `ref`](./elements.md#common-props); `element` on the received node is the backing canvas. |
| `opacity` | `number` | `1` | Paint opacity, `0`–`1`. |

Like all paints it stacks with siblings in document order and clips to the parent's box (including `cornerRadius`). `<surfacePaint>` takes no children.

## Persistence and export

The module is re-executed in every context, so the drawing is reproducible rather than ephemeral: on reload, export, and [`dapi capture`](../capture.md) the engine re-runs your drawing code against a fresh canvas driven by that context's playhead, so ticker surfaces animate in exports. The bitmap itself is not stored; your code reproduces it. This assumes the module's structure is deterministic (`Math.random()`/`Date.now()` must not decide the shape of the tree; using them inside a draw effect is fine).

**Async setup has to be held.** Because that re-execution is a fresh mount, a model, a texture, or a device your drawing waits for is fetched again there — and sampling begins as soon as the render returns, so the first frames are written from a canvas nothing has drawn into yet. Hand the promise to [`useTicker().hold`](./lifecycle.md#hold) and those frames wait for it:

```tsx
const { hold } = useTicker();

onMount(() => {
  const ready = loadModel().then((model) => { scene.add(model); setLoaded(true); });
  hold(ready);
});
```

The hold makes the frames wait; the signal it sets is what redraws the canvas once the work lands — both are needed.

## Requirements and limitations

- Duplicating or copy-pasting a mounted surface yields a static copy (the drawing does not re-run for the copy); re-mount to get a fresh animated instance.
- Only the `ref` attribute form on the element itself is routed; refs inside spread props are not.
- A real DOM `<canvas>` is not available inside [`<html>`](./html.md) content — its pixels don't survive the html-in-canvas rasterization, and the tag is rejected. Use `<surface>` for hand-drawn graphics instead.
