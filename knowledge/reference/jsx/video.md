# `<video>`

A video clip: a rect whose intrinsic paint is the media `src` names (see [media.md](./media.md)). When timing is omitted, the node fits its natural duration (see [timing.md](./timing.md)).

```tsx
<video src="b-roll/drone.mp4" width={1920} height={1080} start={0} sourceIn={1} sourceOut={13} volume={-3} />
```

## Props

All [common props](./elements.md#common-props), plus:

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `src` | `string \| AssetRef` | **required** | See [media.md](./media.md). |
| `objectFit` | `"cover" \| "contain" \| "fill"` | `"cover"` | How the source maps into the box. |
| `frameRate` | `number` | `30` | Frames per second for a `src` naming a directory of numbered frames — the only thing that says how long such a clip runs. Nothing for encoded video to read: a file carries its own rate (see [media.md](./media.md#image-sequences)). |
| `volume` | `number` | `0` | Decibels: `0` = unity, negative attenuates (`-6` ≈ half as loud), `-Infinity` = silence. Not linear. |
| `muted` | `boolean` | `false` | Excludes the node's audio from the mix; independent of `volume`. |
| `syncTo` | `string` | none | `id` of another element carrying audio; derives `start` by audio alignment (see [audio-sync.md](./audio-sync.md)). Mutually exclusive with `start`. |
| `upscale` | `number` | `1` | Resolution multiplier; enlarges the source, not the box (see [media.md](./media.md#source-modifiers)). |
| `addAudio` | `boolean` | `false` | Scores footage that has no sound (see [media.md](./media.md#source-modifiers)). |
| `error` | `string` | none | Why this element's source never became an asset (see [errors.md](./errors.md#failed-sources)). |

Without `width`/`height` the box is 1920×1080.

A paint child draws over the media paint created by `src` (see [paints.md](./paints.md)); a [`<shaderPaint>`](./shader-paint.md) child instead post-processes it, so the frame renders through the shader. `<stroke>`, `<shadow>`, `<effect>`, `<animation>` and `<keyframeTrack>` children are valid too.
