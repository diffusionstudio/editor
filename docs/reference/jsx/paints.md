# Paints

Internally a node's fill is not a property but a **paint child**: a sub-entity appended to the geometry, exactly like the editor's fill list. The `fill` prop is shorthand for a solid paint; declaring paints as JSX children exposes the full model, including gradients:

```tsx
<rect width={640} height={360} cornerRadius={24}>
  <linearGradientPaint x1={0.5} y1={0} x2={0.5} y2={1}>
    <colorStop offset={0} color="#FF0055" />
    <colorStop offset={1} color="#0055FF" />
  </linearGradientPaint>
</rect>
```

Paint elements are valid inside any filled visual element (`<rect>`, `<text>`, `<textRange>`, `<video>`, `<image>`, `<html>`, `<surface>`, and a `<scene>`); a `<group>` has no fill of its own, so it takes none. Multiple paints stack in document order; later paints render on top, and a paint child on a `<video>`/`<image>` draws over the media paint created by `src`.

| Element | Props | Meaning |
| ------- | ----- | ------- |
| `<solidPaint>` | `color` (**required**), `opacity` | Solid fill; equivalent to the `fill` prop. |
| `<linearGradientPaint>` | `x1`, `y1`, `x2`, `y2`, `opacity` | Linear gradient along a line in the parent's box — see below. |
| `<radialGradientPaint>` | `cx`, `cy`, `rx`, `ry`, `rotation`, `opacity` | Radial gradient out to an ellipse in the parent's box — see below. |
| `<angularGradientPaint>` | `cx`, `cy`, `rx`, `ry`, `rotation`, `opacity` | Angular (conic) gradient sweeping around a center in the parent's box — see below. |
| `<colorStop>` | `offset` (**required**, `0`–`1`), `color` (**required**), `opacity` | Gradient color stop. Valid only inside gradient paints, which take no other children. |
| `<imagePaint>` / `<videoPaint>` | `src` (**required**), `objectFit`, `frameRate`, `opacity` | Media painted into the parent's box — see below. |
| [`<htmlPaint>`](./html.md) | `opacity`, HTML children | Reactive HTML laid out and drawn into the parent's box (flagged Chromium API). `<html>` is shorthand for a `<rect>` carrying one. |
| [`<surfacePaint>`](./surface-paint.md) | `opacity`, `ref` | A canvas your `ref` draws into (any context type), sampled into the parent's box every frame. `<surface>` is shorthand for a `<rect>` carrying one. |
| [`<shaderPaint>`](./shader-paint.md) | `wgsl` (**required**), `uniforms`, `opacity` | A WGSL fragment shader applied to the video/image paint directly below it (that media renders only through the shader's output), or run procedurally when there is none. |

Every paint also takes `blendMode` and `hidden`, which mean on a paint what they mean on a node.

Colors accept any CSS color; alpha is ignored (use `opacity`). `color`, `opacity`, `offset`, and a gradient's placement props are animatable with `<keyframeTrack>` children (see [keyframes.md](./keyframes.md)), so gradients can animate. Paints have no timing props of their own and cannot be roots.

## Placing a gradient

Gradients are placed the way SVG places them by default (`gradientUnits="objectBoundingBox"`): in fractions of the parent's box, not px. `0`–`1` spans the box's width horizontally and its height vertically, so a gradient keeps its place when the box is resized. Values outside `0`–`1` reach past the edges.

A `<linearGradientPaint>` draws stop `0` at (`x1`, `y1`) and stop `1` at (`x2`, `y2`), SVG's names:

| Prop | Default | Meaning |
| ---- | ------- | ------- |
| `x1`, `y1` | `0`, `0.5` | Start of the line. |
| `x2`, `y2` | `1`, `0.5` | End of the line. |

Unplaced, the line runs across the middle of the box, left to right, edge to edge. A gradient from the top-left corner to the bottom-right one:

```tsx
<rect width={1920} height={1080}>
  <linearGradientPaint x1={0} y1={0} x2={1} y2={1}>
    <colorStop offset={0} color="#FF0055" />
    <colorStop offset={1} color="#0055FF" />
  </linearGradientPaint>
</rect>
```

A `<radialGradientPaint>` draws stop `0` at its center and stop `1` on an ellipse around it: SVG's `cx`/`cy`, with the `rx`/`ry` of SVG's `<ellipse>`:

| Prop | Default | Meaning |
| ---- | ------- | ------- |
| `cx`, `cy` | `0.5` | Center. |
| `rx`, `ry` | `0.5` | Radii; `rx` is a fraction of the box's width, `ry` of its height. |
| `rotation` | `0` | Turns the radii, degrees clockwise. |

Unplaced, the ellipse is centered and touches the middle of each edge, so it is a circle only on a square box. A glow in the top-left quarter of the box:

```tsx
<rect width={1920} height={1080}>
  <radialGradientPaint cx={0.25} cy={0.25} rx={0.25} ry={0.25}>
    <colorStop offset={0} color="#FFFFFF" />
    <colorStop offset={1} color="#000000" />
  </radialGradientPaint>
</rect>
```

Keyframing the points moves each one in a straight line, so a linear gradient turned by keyframes shortens on the way (a half turn collapses at its midpoint); key a quarter turn at a time to keep its length. A radial gradient's `rotation` turns along an arc.

An `<angularGradientPaint>` sweeps its stops once around a center, like Figma's angular gradient or CSS's `conic-gradient`: stop `0` starts along the `rx` radius (to the right of the center when unrotated) and the sweep turns clockwise through `ry` back to the start. It takes the radial gradient's props with the same defaults; `rotation` turns where the sweep starts, and the radii shape it: on a stretched ellipse the stops spread out across its short ends and crowd toward its long ends. A color wheel:

```tsx
<rect width={1080} height={1080}>
  <angularGradientPaint>
    <colorStop offset={0} color="#FF0000" />
    <colorStop offset={0.33} color="#00FF00" />
    <colorStop offset={0.67} color="#0000FF" />
    <colorStop offset={1} color="#FF0000" />
  </angularGradientPaint>
</rect>
```

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
