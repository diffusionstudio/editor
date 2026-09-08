# Animations

`<animation>` declares one **preset in/out animation** on the clip holding it: it plays over the clip's head (`"in"`) or tail (`"out"`), between the node's static state and the preset's start/end state. For hand-authored motion on individual props, use [keyframes](./keyframes.md); the two compose on distinct properties.

```tsx
<video src="b-roll/intro.mp4" width={1920} height={1080} start={0} end={8}>
  <animation type="fade" duration="15f" />
  <animation type="slideUp" phase="out" duration={0.5} delay={0.2} />
</video>
```

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `type` | `AnimationType` (**required**) | | Preset, see below. |
| `phase` | `"in" \| "out"` | `"in"` | Plays from the clip's head or into its tail. |
| `duration` | `Time` | 1 second | Length of the animation. |
| `delay` | `Time` | `0` | Gap between the clip edge and the animation: after the head for `"in"`, before the tail for `"out"`. |

Valid under any node (`<rect>`, `<text>`, `<video>`, `<image>`, `<audio>`, `<group>`, `<captions>`, `<adjustmentLayer>`). An `<animation>` is an element like any other: it has an `id`, the editor writes changes back to it, and it is copied with its node.

## Types

The editor's animations inspector options:

| `type` | Effect |
| ------ | ------ |
| `"fade"` | Opacity ramp. |
| `"slideLeft"`, `"slideRight"`, `"slideUp"`, `"slideDown"` | Slide in from (or out toward) the named direction, fading. |
| `"grow"` | Scales up from 50%. |
| `"shrink"` | Scales down from 150%. |
| `"spin"` | Scale plus rotation. |
| `"twist"` | Overscale plus rotation and offset. |
| `"blur"` | 24px blur ramp. |
| `"appearWord"` | Text only: reveals the text word by word. |
| `"appearChar"` | Text only: reveals the text character by character. |
| `"scramble"` | Text only: resolves scrambled characters into the text. |
| `"gain"` | Audio only: volume ramp (fade-in/fade-out of the mix). No visual effect. |

Text types apply only to [`<text>`](./text.md) and [`<captions>`](./captions.md).

## Semantics

- `duration` and `delay` take any [time format](./timing.md#time-formats). An `"in"` animation plays over `[delay, delay + duration]` from the clip's in point; an `"out"` animation ends `delay` before the clip's out point. Both track the clip when it is retimed.
- A node takes **any number of animations**; overlapping ones apply in document order, later ones writing over earlier ones on the properties they share. A [keyframe track](./keyframes.md) on the same property (say, a keyframed `opacity` next to `"fade"`) overrides the preset while it has keyframes; presets and keyframes on distinct properties compose freely.
