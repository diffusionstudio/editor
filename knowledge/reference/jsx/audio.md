# `<audio>`

An audio clip: no picture, carries volume. When timing is omitted, the node fits its natural duration (see [timing.md](./timing.md)).

It draws nothing inside a scene, but on the canvas it is still something to point at: the editor shows its waveform in a box, and `x`/`y`/`width`/`height` are where that box is. Leave them off inside a scene, where they mean nothing.

```tsx
<audio src="music/bed.mp3" start={2.2} sourceOut={16} volume={-6} />
```

## Props

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `src` | `string \| AssetRef` | **required** | See [media.md](./media.md). |
| `id`, `name` | `string` | see [elements.md](./elements.md#common-props) | Address and label. |
| `x`, `y` | `number` | `0` | Where the waveform box sits on the canvas. No meaning inside a scene. |
| `width`, `height` | `number` | `500`, `150` | Size of that box. |
| `start`, `end`, `sourceIn`, `sourceOut` | `Time` | see [timing.md](./timing.md) | Temporal placement. |
| `playbackRate` | `number` | `1` | Speed multiplier for the clip's local time. |
| `volume` | `number` | `0` | Decibels: `0` = unity, negative attenuates (`-6` ≈ half as loud), `-Infinity` = silence. Not linear. |
| `muted` | `boolean` | `false` | Excludes the node's audio from the mix; independent of `volume`. |
| `syncTo` | `string` | none | `id` of another element carrying audio; derives `start` by audio alignment (see [audio-sync.md](./audio-sync.md)). Mutually exclusive with `start`. |
| `error` | `string` | none | Why this element's source never became an asset (see [errors.md](./errors.md#failed-sources)). |

An audio clip has no picture, so it takes no transform beyond its canvas box and no paints. Its children are [`<keyframeTrack>`](./keyframes.md) (a `volume` track) and [`<animation>`](./animations.md), of which only `"gain"` is audible:

```tsx
<audio src="music/bed.mp3" start={0} end={12} volume={-16}>
  <animation type="gain" duration={1} />
  <animation type="gain" phase="out" duration={2} />
</audio>
```
