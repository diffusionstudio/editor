# `<rect>`

A rectangle. Takes [paint children](./paints.md), plus [`<stroke>`, `<shadow>`, `<effect>`](./styles.md), [`<animation>`](./animations.md) and [`<keyframeTrack>`](./keyframes.md); use `cornerRadius` for rounded corners.

```tsx
<rect x={40} y={40} width={640} height={360} cornerRadius={24} fill="#FF0055" />
```

## Props

All [common props](./elements.md#common-props), plus:

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `fill` | `string` | none | Any CSS color; alpha is ignored (use `opacity`). Shorthand for a solid paint child, drawn beneath any paint children. |
| `mask` | `boolean` | `false` | Makes the rect a mask of its parent instead of a drawn shape — see below. |

A rect with neither `fill` nor a paint child draws nothing; it is still a box that clips masks, carries children and takes up its place in the timeline. Without `width`/`height` a rect is 100×100.

## Masks

A `<rect mask>` clips the element holding it instead of drawing: the parent's fills, strokes, shadows and children show only inside the rect's box. It is still a rect — same coordinates, `cornerRadius`, transform and timing — so it can be moved, rotated, keyframed and animated independently of what it clips: a mask whose `width` is keyframed across a text is a wipe, a mask that starts later than its parent is a reveal.

```tsx
<text fontSize={120} color="#FFFFFF" textAlign="center" textBaseline="middle">
  Hello World
  <rect mask>
    <keyframeTrack property="width">
      <keyframe time={0} value={0} />
      <keyframe time={1} value={1920} easing="easeOut" />
    </keyframeTrack>
  </rect>
</text>
```

- Any node can hold masks (`<rect>`, `<text>`, `<video>`, `<image>`, `<group>`, `<scene>`); the mask clips that element as a whole.
- Several masks under one element **intersect**: content shows only where every mask covers it.
- Outside the mask's own time window it does not clip and the parent shows in full. Without `end` (or `sourceOut`) a mask clips for the parent's whole window, not the usual 16 s default.
- Never rendered and never hit on the canvas, so `fill`, `opacity`, `blendMode` and paint / stroke / shadow / effect children have no effect on it.
- Without `width`/`height` a mask is 500×500 (a plain rect is 100×100).
- `hidden` on a mask does not switch it off (it is skipped by role before hiding is looked at); use timing, or set `mask={false}`.
