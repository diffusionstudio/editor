# `<polygon>`

A regular polygon stretched to fill its box, its first corner at the top center: a triangle by default, apex up and base along the bottom edge. Takes the same children as [`<rect>`](./rect.md): [paint children](./paints.md), plus [`<stroke>`, `<shadow>`, `<effect>`](./styles.md), [`<animation>`](./animations.md) and [`<keyframeTrack>`](./keyframes.md).

```tsx
<polygon x={760} y={340} width={400} height={400} pointCount={6} fill="#FFFFFF">
  <stroke color="#000000" width={8} join="round" />
</polygon>
```

## Props

All [common props](./elements.md#common-props), plus:

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `pointCount` | `number` | `3` | How many corners. Rounded to a whole number; anything under 3 is 3. Not animatable. |
| `fill` | `string` | none | Any CSS color; alpha is ignored (use `opacity`). Shorthand for a solid paint child, drawn beneath any paint children. |
| `clipPath` | `boolean` | `false` | Makes the polygon a clip path of its parent instead of a drawn shape: the parent shows only inside its outline. Works like [`<rect clipPath>`](./rect.md#clip-paths). |

Without `width`/`height` a polygon is 100×100. The corners sit on an ellipse and are then stretched so the outline touches every side of the box, so a triangle fills its box's full height rather than leaving a gap below its base. The canvas only picks it up inside the outline.
