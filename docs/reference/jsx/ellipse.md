# `<ellipse>`

An ellipse inscribed in its box: a circle when `width` and `height` are equal. Takes the same children as [`<rect>`](./rect.md): [paint children](./paints.md), plus [`<stroke>`, `<shadow>`, `<effect>`](./styles.md), [`<animation>`](./animations.md) and [`<keyframeTrack>`](./keyframes.md).

```tsx
<ellipse x={760} y={340} width={400} height={400} fill="#FF0055" />
```

## Props

All [common props](./elements.md#common-props), plus:

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `fill` | `string` | none | Any CSS color; alpha is ignored (use `opacity`). Shorthand for a solid paint child, drawn beneath any paint children. |
| `clipPath` | `boolean` | `false` | Makes the ellipse a clip path of its parent instead of a drawn shape: the parent shows only inside the curve. Works like [`<rect clipPath>`](./rect.md#clip-paths). |

Without `width`/`height` an ellipse is 100×100. Fills, strokes, shadows and [masked effects](./styles.md) follow the curve, and the canvas only picks it up inside the curve rather than anywhere in its box.
