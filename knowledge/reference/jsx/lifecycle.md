# Lifecycle

## A mount stays live

Opening a project compiles the entry file and renders it into the document. After that the reactive graph **keeps running**: signals, effects, timers, and [`useTicker`](#useticker) keep driving the mounted entities for as long as the project is open. Updates land in the document immediately — prop writes, conditional inserts and removals (`<Show>`, `<For>`), text, and reactive `src` swaps including `generate.*`. The materialized nodes are ordinary editable entities; asset resolution is owned by the engine.

A save re-runs the pipeline. The old mount is disposed and the new render takes the stage, the way reloading a page rebuilds it — scenes are rebuilt rather than accumulated, and the entities the previous render owned go with it. A compile error changes nothing: the last good render stays on the canvas and the failure is reported.

The compiled bundle is remembered with the project, so the next open puts the last known render on the canvas while the compile chews through the sources; whichever finishes first shows, and the fresh compile replaces it either way.

**Export and capture re-execute the module** in a world of their own — the same source, a fresh mount, the ticker driven across the frames being rendered. That is what makes a live composition reproducible rather than ephemeral, and it requires the module's structure to be deterministic: `Math.random()` and `Date.now()` must not decide element counts or `<Show>`/`<For>` branches. Using them inside an effect, or inside a draw callback, is fine.

## Edits come back

The other direction is the point of the [`id`](./module.md#ids) on every element: a rect dragged on the canvas, a clip trimmed on the timeline, a keyframe moved, a line retyped — each lands as a prop on the element that authored it, written into your file. So the two directions do not fight: hand edits and canvas edits are edits to the same document.

What the editor writes is what it changed. Elements it inserted or moved are written as new JSX; an element rendered inside a `<For>` is unrolled into one element per iteration first, since a single element cannot hold one iteration's value.

## `useTicker`

A project can subscribe to the timeline instead of reaching for wall-clock timers:

```tsx
import { useTicker } from "@diffusionstudio/jsx";

export default function Project() {
  const { time, frame } = useTicker();
  return (
    <stage camera={[0.3, 0, 0, 0.3, 85, 150]}>
      <scene name="HUD" width={1920} height={1080} active>
        <text width={600} height={100} fontSize={80} color="#FFFFFF">{`frame ${frame()}`}</text>
        <rect x={860 + Math.sin(time() * 4) * 200} y={490} width={100} height={100} fill="#f43" />
      </scene>
    </stage>
  );
}
```

Call it in a component body. It returns accessors for the playhead of the scene the mount renders into:

| Accessor | Value |
| -------- | ----- |
| `time()` | Playhead in seconds (sub-frame precision while playing) |
| `frame()` | Playhead in frames (30 fps) |
| `delta()` | Seconds advanced since the previous engine tick: 0 while paused, negative on a backward scrub or loop |
| `playing()` | Whether the scene is playing |
| `hold(work)` | Holds the frames an export or a capture is sampling until `work` settles — see [below](#hold) |

The values respect play, pause, scrubbing, looping, and playback speed, which wall-clock timers do not. Each accessor only propagates when its value changes, so a paused scene re-runs nothing and `frame()` consumers update at most once per frame. Ticker-driven drawing follows the playhead in the editor **and in exports and captures**; wall-clock timers (`setInterval`, `requestAnimationFrame`) render live but do not appear in the output.

`useTicker` is host-bound: it only works inside a mounted project, and throws with a message saying so anywhere else.

## `useResolution`

The host's rasterization density, as one reactive accessor: how many device pixels one composition pixel is drawn with, camera zoom excluded.

```tsx
import { useResolution } from "@diffusionstudio/jsx";

const resolution = useResolution();
```

| Context | Value |
| ------- | ----- |
| Live editor | The display's pixel ratio (2 on a retina screen) |
| Export | The `resolution` setting's scale — 2 when a 960×540 scene encodes at 1080p |
| Capture | The capture's scale, the same way |

Vector content (shapes, text, gradients) rasterizes through this scale automatically and never needs it. It exists for **bitmaps a project draws itself** — a [`<surface>`](./surface-paint.md) whose canvas would otherwise be stretched from composition size into a larger output. Multiply the bitmap size by `resolution()` and draw at that density, and the sampled pixels stay sharp at any output size (see [surface-paint.md](./surface-paint.md#adapting-to-the-output-resolution)).

It is an accessor, not a constant: an export mounts the module before it configures its scale, so the value starts at `1` and moves to the real factor before the first frame is sampled. Read it inside the effect that sizes and draws — a read at mount sees the initial value and never the correction. Like `useTicker` it is host-bound and throws outside a mounted project.

## `hold`

An export or a capture does not photograph the live mount — it **mounts the module again**, in a world of its own, and starts sampling as soon as that render returns. So a project's own async work races the first frames: a mesh fetched in `onMount`, a WebGPU device, a `fetch` whose answer decides a layout. The picture on the canvas has been there for minutes; the one in the encoder is a few milliseconds old.

`hold` is how a project says that a frame is not ready yet:

```tsx
const { hold } = useTicker();

onMount(() => {
  const ready = new GLTFLoader().loadAsync(MODEL_URL).then((gltf) => {
    scene.add(gltf.scene);
    setLoaded(true); // wake the draw effect
  });

  hold(ready); // the encoder waits for the model before sampling a frame
});
```

- **Held during the mount**, the promise is awaited before the first frame is written — the same barrier the engine's own decoders and sources wait behind. Nothing later needs to wait for it, since the frame it held did.
- **Held during a tick** (inside an effect, a draw callback), it is awaited before *that* frame is sampled. Work that is not done once — a texture that streams in, an `ImageBitmap` decode, a readback — is held on every tick it is still pending, the way a decoder that is not ready re-registers its own promise each frame.
- **Live playback holds nothing.** Nothing in the editor waits for a frame, so `hold` there is a no-op and costs a mounted project nothing.
- **Holding is not drawing.** The barrier makes the frame wait; something still has to redraw once the work lands — hence the `setLoaded(true)` above, read inside the draw effect. Without it the frame waits and is still sampled blank.
- A held promise is **settled either way and bounded**: a rejection is logged rather than failing the export, and a promise that never settles is given up on after 30 seconds so a render cannot hang on it.
