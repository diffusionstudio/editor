# `<image>`

A picture: a rect whose intrinsic paint is the media `src` names (see [media.md](./media.md)).

```tsx
<image src="stills/photo.jpg" x={40} y={40} width={200} height={112} />
```

## Props

All [common props](./elements.md#common-props), plus:

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `src` | `string \| AssetRef` | **required** | See [media.md](./media.md). |
| `objectFit` | `"cover" \| "contain" \| "fill"` | `"cover"` | How the source maps into the box. |
| `frameRate` | `number` | `30` | Frames per second for a `src` naming a directory of numbered frames, which plays on `<image>` as footage does (see [media.md](./media.md#image-sequences)). Nothing for a still to read. |
| `removeBackground` | `boolean` | `false` | Cuts the subject out, leaving the rest transparent (see [media.md](./media.md#source-modifiers)). |
| `upscale` | `number` | `1` | Resolution multiplier; enlarges the source, not the box (see [media.md](./media.md#source-modifiers)). |
| `error` | `string` | none | Why this element's source never became an asset (see [errors.md](./errors.md#failed-sources)). |

Without `width`/`height` the box is 1920×1080. A still has no duration to fit, so with no `end` it takes the 16-second default (see [timing.md](./timing.md)).

A paint child draws over the media paint created by `src` (see [paints.md](./paints.md)); a [`<shaderPaint>`](./shader-paint.md) child instead post-processes it, so the image renders through the shader. `<stroke>`, `<shadow>`, `<effect>`, `<animation>` and `<keyframeTrack>` children are valid too.
