# Paints

Internally a node's fill is not a property but a **paint child**: a sub-entity appended to the geometry, exactly like the editor's fill list. The `fill` prop is shorthand for a solid paint; declaring paints as JSX children exposes the full model, including gradients:

```tsx
<rect width={640} height={360} cornerRadius={24}>
  <linearGradientPaint rotation={90}>
    <colorStop offset={0} color="#FF0055" />
    <colorStop offset={1} color="#0055FF" />
  </linearGradientPaint>
</rect>
```

Paint elements are valid inside any filled visual element (`<rect>`, `<text>`, `<textRange>`, `<video>`, `<image>`, `<html>`, `<surface>`, and a `<scene>`); a `<group>` has no fill of its own, so it takes none. Multiple paints stack in document order; later paints render on top, and a paint child on a `<video>`/`<image>` draws over the media paint created by `src`.

| Element | Props | Meaning |
| ------- | ----- | ------- |
| `<solidPaint>` | `color` (**required**), `opacity` | Solid fill; equivalent to the `fill` prop. |
| `<linearGradientPaint>` | `rotation`, `opacity` | Linear gradient across the parent's box; `rotation` in degrees, `0` = left to right. |
| `<radialGradientPaint>` | `rotation`, `opacity` | Radial gradient centered in the parent's box. |
| `<colorStop>` | `offset` (**required**, `0`–`1`), `color` (**required**), `opacity` | Gradient color stop. Valid only inside gradient paints, which take no other children. |
| `<imagePaint>` / `<videoPaint>` | `src` (**required**), `objectFit`, `frameRate`, `opacity` | Media painted into the parent's box — see below. |
| [`<htmlPaint>`](./html.md) | `opacity`, HTML children | Reactive HTML laid out and drawn into the parent's box (flagged Chromium API). `<html>` is shorthand for a `<rect>` carrying one. |
| [`<surfacePaint>`](./surface-paint.md) | `opacity`, `ref` | A canvas your `ref` draws into (any context type), sampled into the parent's box every frame. `<surface>` is shorthand for a `<rect>` carrying one. |
| [`<shaderPaint>`](./shader-paint.md) | `wgsl` (**required**), `uniforms`, `opacity` | A WGSL fragment shader applied to the video/image paint directly below it (that media renders only through the shader's output), or run procedurally when there is none. |

Every paint also takes `blendMode` and `hidden`, which mean on a paint what they mean on a node.

Colors accept any CSS color; alpha is ignored (use `opacity`). `color`, `opacity`, and `offset` are animatable with `<keyframeTrack>` children (see [keyframes.md](./keyframes.md)), so gradients can animate. Paints have no spatial or timing props of their own and cannot be roots.

## Media paints

`<imagePaint>` and `<videoPaint>` are the same media a [`<video>`](./video.md) or [`<image>`](./image.md) element is, as a paint child: they fill *something else* with it, so a rect or a text can be filled with a picture.

```tsx
<text fontSize={220} fontWeight="bold" width={1920} textAlign="center">
  OCEAN
  <videoPaint src="b-roll/waves.mp4" objectFit="cover" />
</text>
```

They take `src` exactly as the elements do (see [media.md](./media.md)), plus `objectFit` and `frameRate`. Which tag it is only says what the source is expected to be: the paint follows what the `src` turns out to name, so a frames directory plays under either.

The media paint a `<video>` or `<image>` element creates from its own `src` is *intrinsic* — it sits at the bottom of that element's paint stack, beneath any paint child. Timing stays the element's; a media paint has none of its own.
