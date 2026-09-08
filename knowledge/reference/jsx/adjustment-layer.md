# `<adjustmentLayer>`

A layer that draws nothing of its own and transforms **the clip below it**. While the layer's clip lasts, its transform composes onto that of the sibling directly beneath it in the stack, so a punch-in, a drift or a keyframed zoom is authored once, in a row of its own, and trimmed and slid along the timeline without the clip it acts on being touched.

```tsx
<scene name="Interview" width={1920} height={1080}>
  <video src="a-roll/interview.mp4" />
  <adjustmentLayer start={2} end={6} scale={1.4} />
</scene>
```

Keyframe it the way any node is keyframed (see [keyframes.md](./keyframes.md)) — this is what the element is for:

```tsx
<adjustmentLayer name="Punch in" start={2} end={6}>
  <keyframeTrack property="scale">
    <keyframe time={0} value={1} easing="easeInOut" />
    <keyframe time={2} value={1.6} />
  </keyframeTrack>
</adjustmentLayer>
```

## What it acts on

The **preceding sibling** — one clip, the one drawn directly beneath the layer — for as long as the layer's own `start`/`end` window lasts. Outside that window, or with `hidden`, the clip is left alone. A layer that is the first child of its parent has nothing beneath it and does nothing.

Inside a [`<sequence>`](./sequences.md) the layer acts on what sits below the *sequence*, not on the clip before it inside one: a sequence is a row of clips over time, so "beneath" is measured against the row.

## Props

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `x`, `y` | `number` | `0` | Translation applied to the clip below, px. |
| `offsetX`, `offsetY` | `number` | `0` | Render-time translation on top of `x`/`y`, px. |
| `rotation` | `number` | `0` | Rotation in degrees, about the box centre. |
| `scale` | `number` | `1` | Uniform scale about the box centre. Overrides `scaleX`/`scaleY` while set. |
| `scaleX`, `scaleY` | `number` | `1` | Per-axis scale. |
| `width`, `height` | `number` | `1920` × `1080` | **Never drawn**: the box the transform pivots around. Set them to the scene's own size on a frame shaped otherwise, so `rotation` and `scale` turn about its middle. |
| `hidden` | `boolean` | absent | Excludes the layer without removing it: the clip below is left alone and the layer keeps its place in the timeline. |
| `start`, `end` | `Time` | see [timing.md](./timing.md) | When the layer acts. A layer is sourceless, so with no `end` it takes the 16-second default. |
| `id`, `name` | `string` | see [elements.md](./elements.md#common-props) | Address and label. |

It has no `fill`, no `opacity` and no `blendMode`: it has no pixels of its own to give them to. Its children are [`<animation>`](./animations.md) and [`<keyframeTrack>`](./keyframes.md) elements — what the layer's transform is animated with.
