# Strokes, shadows and effects

Three sub-entity children a node takes alongside its [paints](./paints.md): an outline of its shape, a shadow beneath it, and a filter over what it drew. Each stacks in document order, several of a kind are allowed, and each carries an `id` of its own — the editor writes a changed value back to the element that spelled it, and it is copied with its node.

```tsx
<text fontSize={140} fontWeight="bold" color="#FFFFFF" width={1920} textAlign="center">
  Headline
  <stroke color="#000000" width={6} join="round" />
  <shadow color="#000000" blur={24} offsetY={8} opacity={0.6} />
</text>
```

## `<stroke>`

An outline of the parent's box — or of its glyphs, on a `<text>` or a `<textRange>`. `color`/`opacity` are its paint, the rest its line style.

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `color` | `string` | **required** | Any CSS color; alpha is ignored (use `opacity`). |
| `width` | `number` | `1` | Line width, px. A `width` [keyframe track](./keyframes.md) under a stroke drives this, not a box. |
| `join` | `"miter" \| "round" \| "bevel"` | `"miter"` | How the stroke turns corners. |
| `cap` | `"butt" \| "round" \| "square"` | `"butt"` | How the stroke ends open paths (text glyphs). |
| `miterLimit` | `number` | `10` | Miter length limit, as a ratio of the width. |
| `opacity` | `number` | `1` | `0`–`1`. |
| `blendMode` | `BlendMode` | `"sourceOver"` | How the stroke composites. |
| `hidden` | `boolean` | absent | Excludes the stroke without removing it. |

## `<shadow>`

A drop shadow beneath the parent's silhouette: a blurred, offset copy of it in `color`.

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `color` | `string` | **required** | Any CSS color. |
| `blur` | `number` | `0` | Blur radius, px. |
| `offsetX`, `offsetY` | `number` | `0` | Where the shadow sits relative to the silhouette, px. |
| `opacity` | `number` | `1` | `0`–`1`. |
| `hidden` | `boolean` | absent | Excludes the shadow without removing it. |

## `<effect>`

A filter over the parent's **rendered pixels** — its fills, strokes and children together. On a [`<group>`](./group.md) that is the group as a whole; on a [`<video>`](./video.md) it is the frame after the media is drawn. A [`<mask>`](#mask) child limits where the effect applies.

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `type` | `EffectType` | **required** | Which filter to apply, see below. |
| `value` | `number` | **required** | The amount. |
| `hidden` | `boolean` | absent | Excludes the effect without removing it. |

| `type` | `value` means |
| ------ | ------------- |
| `"blur"` | Radius in px. |
| `"hueRotate"` | Degrees. |
| `"brightness"`, `"contrast"`, `"grayscale"`, `"invert"`, `"saturate"`, `"sepia"` | Amount, `0`–`1`. |
| `"opacity"` | The node's opacity as an effect, `0`–`1`. With a `<mask>` under it, what is outside the mask goes transparent: the cut-out. |

```tsx
<image src="stills/photo.jpg" width={1920} height={1080}>
  <effect type="blur" value={0}>
    <keyframeTrack property="value">
      <keyframe time={0} value={40} easing="easeOut" />
      <keyframe time={1.5} value={0} />
    </keyframeTrack>
  </effect>
</image>
```


## `<mask>`

A matte limiting the `<effect>` holding it: a **picture** whose alpha says where the effect applies, fitted into the node's box the way the node fits its footage. It is what the editor's object mask tool makes — pick an object in a video clip, track it, and the frames it found are written to the library and named by `src`. Several under one effect intersect. Without a `src` a `<mask>` does nothing.

Under an `"opacity"` effect the mask is the cut-out: the clip shows inside the mask and goes transparent outside, as a mask on Premiere's Opacity does. Under any other effect the effect shows through inside the mask and the picture is untouched outside: an inverted mask on a `"blur"` blurs the background behind a person.

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `src` | `string` | none | The frames, a directory of numbered images whose alpha is the mask. |
| `sourceIn` | `Time` | `0` | The node's source time the first frame belongs to, so the mask stays on the footage it was made from whatever the trim. |
| `frameRate` | `number` | `30` | Frames per second the frames were written at (the composition's). |
| `blur` | `number` | `0` | Feather: radius in px the edge falls off over. |
| `opacity` | `number` | `1` | How strongly the mask limits the effect. `1` stops the effect at the edge; lower lets that much of it through outside; `0` is no mask. |
| `inverted` | `boolean` | `false` | Covers what the picture does not instead. |
| `hidden` | `boolean` | absent | Switches the mask off without removing it. |

`blur` and `opacity` take a [`<keyframeTrack>`](./keyframes.md).

```tsx
<video src="footage/skater.mp4" width={1920} height={1080}>
  <effect type="opacity" value={1}>
    <mask src="masks/skater" sourceIn={2} frameRate={30} blur={6} />
  </effect>
</video>
```

## Animating them

All three take [`<keyframeTrack>`](./keyframes.md) children, and the track's `property` is read against its holder: `width` under a `<stroke>` is the line width, `blur` / `offsetX` / `offsetY` under a `<shadow>` are the shadow's, `value` under an `<effect>` is its amount, and `color` / `opacity` are whatever the holder's are.
