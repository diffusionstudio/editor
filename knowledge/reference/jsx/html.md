# `<html>`

An element whose children are **real HTML**: the browser lays them out at the element's box size and the result is drawn into the box via the [html-in-canvas](https://github.com/WICG/html-in-canvas) API. The Diffusion Studio app ships with this API enabled, so `<html>` is always available — reach for it liberally. It is the recommended way to build motion graphics, overlays, and any UI-heavy content: styled cards, tables, code blocks, flex/grid layouts — anything painful to assemble from `<rect>` and `<text>`.

Driving the markup with an [anime.js](https://animejs.com) timeline is **recommended** — it keeps the animation frame-accurate: build the timeline with `autoplay: false`, then `seek` it from the [`useTicker`](./lifecycle.md#useticker) playhead so it follows scrubbing and exports rather than the wall clock. anime.js works in milliseconds, so the playhead is scaled by 1000 on the way into `seek`.

```tsx
import { createTimeline, type Timeline } from "animejs";
import { useTicker } from "@diffusionstudio/jsx";
import { createEffect, onMount } from "solid-js";

export default function Intro() {
  const { time } = useTicker();
  let index!: HTMLSpanElement;
  let label!: HTMLSpanElement;
  let tl!: Timeline;

  // anime.js resolves targets at tween creation and refs are only assigned
  // during render, so build the timeline in onMount — it runs before the
  // effect below.
  onMount(() => {
    tl = createTimeline({ autoplay: false })
      .add(index, { opacity: { from: 0, to: 1 }, x: { from: -24, to: 0 }, ease: "outQuad", duration: 400 }, 0)
      .add(label, { opacity: { from: 0, to: 1 }, ease: "outQuad", duration: 400 }, 200);
  });

  createEffect(() => tl.seek(time() * 1000));

  return (
    <stage camera={[0.7, 0, 0, 0.7, 90, 270]}>
      <scene name="Intro" width={800} height={120} active>
        <html x={50} y={5} width={700} height={110} cornerRadius={24} end={32}>
          <div style={`display:flex;align-items:center;gap:16px;height:100%;
                       background:#111;color:#fff;font:500 40px Inter;padding:0 32px;`}>
            <span ref={index} style="color:#7c9cff;">01</span>
            <span ref={label}>Introduction</span>
          </div>
        </html>
      </scene>
    </stage>
  );
}
```

Prefer this timeline over hand-animating styles: keep the markup static and let the paused anime.js timeline own every moving value, so one `seek` keeps the whole host frame-accurate. A static `style` may be a plain string, but one spanning multiple lines has to be a template literal in braces (`style={`…`}`), as above. Reach for a derived style only for values the timeline does not drive, and write it as a **style object** (`style={{ color: c() }}`) rather than interpolating the signal into a style string, so each property updates independently.

The `<html>` box carries all [common props](./elements.md#common-props). Its paint child form, [`<htmlPaint>`](./paints.md), draws the same reactive HTML onto any existing filled geometry; `<html>` is just a `<rect>` that carries one.

## Reactivity

The children are part of the project's Solid graph: signals in attributes and text update the live DOM, and the drawn content follows on the next frame. A mounted project stays live, so the graph keeps running and `useTicker` or timers can drive the markup:

```tsx
const [count, setCount] = createSignal(0);
setInterval(() => setCount((c) => c + 1), 1000);

<html width={400} height={200}>
  <div style="font:700 96px Inter;color:#fff;">{count()}</div>
</html>
```

## Images

`<img>` takes the same sources as a composition [`src`](./media.md): a path, an asset id, a URL, or a [`generate.*`](./generate.md) ref. The host resolves them exactly as it does for [`<image>`](./image.md)

## Props

`<html>` takes all [common props](./elements.md#common-props). `<htmlPaint>` takes:

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `opacity` | `number` | `1` | Paint opacity, `0`-`1`. |

Like all paints, `<htmlPaint>` stacks with siblings in document order and clips to the parent's box (including `cornerRadius`).

## Persistence and export

The module is re-executed in every context: on reload, export, and [`dapi capture`](../capture.md) the engine re-executes it and rebuilds the DOM content in that context. Exports wait for the browser's rendering update before sampling each frame, so the drawn HTML appears in the output; ticker-driven signals follow the playhead and animate frame-accurately. This assumes the module's structure is deterministic (`Math.random()`/`Date.now()` must not decide the shape of the tree).

## Requirements and limitations

- `<audio>` and `<video>` tags are rejected: media doesn't play under a paint host. Use the [`<audio>`](./audio.md) and [`<video>`](./video.md) composition elements, which own playback and the timeline. `<canvas>` is rejected too — its pixels don't survive the rasterization; use [`<surface>`](./surface-paint.md).
- **Composition elements cannot appear inside HTML content, and DOM elements cannot appear outside it.** Both are errors at mount, naming which way round it went.
- Pointer and media event handlers on the DOM children are ignored: the subtree is rasterized into the canvas, not interacted with. Styles, classes, attributes, `innerHTML` and `textContent` all apply and are reactive.
- **`<html>` is sourceless, so with no `end` it defaults to a 16-second duration and disappears after 16 s** — a silent cutoff with no error.
- **`scale()` blanks large or clipped subtrees in captures.** The rasterizer renders a subtree as *empty* when a CSS `scale()` sits on a large wrapper (e.g. a full-box `width:100%;height:100%` group), or when any `overflow:hidden` clip lives beneath a scaled ancestor. Animate entrances, holds, and exits with `translate` and `opacity`; use `scale` only on small, content-sized leaf elements with no clipping inside them. A masked text reveal (`overflow:hidden` + inner `translateY`) is fine as long as no ancestor of the mask carries a transform.
- **Fractional `opacity` on a painted box blanks the subtree in captures.** Under an ancestor whose `opacity` is fractional (a wrapper mid-fade), a descendant that carries *both* its own `opacity` < 1 *and* a painted box — `background`, `border`, `box-shadow`, `outline` — makes the rasterizer drop the ancestor's entire subtree for exactly as long as the ancestor's opacity is fractional, so the content is blank mid-fade and pops in the moment the fade lands on 1. Splitting the two across a parent and a child does not help; nor does `will-change`, `isolation`, `contain`, or `filter: opacity()`. Dimming **text** with `opacity` is fine, and so is a box whose background is dimmed with an alpha color — give decorated boxes `rgba()` / `hsl()` alpha instead of `opacity`. In the live editor the dropped subtree does not just go blank: the promoted layer escapes the canvas and paints itself on top of the stage at the canvas's top-left corner, at authored size, with no camera or scene transform — HTML content appearing untransformed over the stage instead of inside its scene is this bug, not a broken transform.
