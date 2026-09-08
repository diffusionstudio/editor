# Element reference

camelCase composition elements map 1:1 onto entities. Lowercase DOM vocabulary is valid only inside [`<html>`](./html.md) content.

## Structure

| Element | What it is |
| ------- | ---------- |
| [`<stage>`](./stage.md) | The infinite canvas, and the only valid root. Holds `<scene>` children, and loose nodes parked beside them. |
| [`<scene>`](./scene.md) | A clipped, playable frame; owns the timeline its children sit on. Only under `<stage>`, never nested. |
| [`<group>`](./group.md) | Container with a transform; auto-fits its box and its span from its children. No size and no fill of its own. |
| [`<sequence>`](./sequences.md) | Track-like container for back-to-back clips, and where [transitions](./transitions.md) are declared. No transform of its own. |

## Nodes

| Element | What it is |
| ------- | ---------- |
| [`<rect>`](./rect.md) | A rectangle. Takes paints, strokes, shadows and effects. With `mask` it clips its parent instead of drawing. |
| [`<text>`](./text.md) | Text; its children are the glyphs. Sizes itself to them unless given a box. |
| [`<textRange>`](./text.md#textrange) | A style override over a run of the parent `<text>`'s glyphs, by character index. |
| [`<video>`](./video.md) | A video clip: a rect whose intrinsic paint is the media `src` names. |
| [`<image>`](./image.md) | A picture: a rect whose intrinsic paint is the media `src` names. |
| [`<audio>`](./audio.md) | A clip with a sound and no picture; on the canvas, a waveform box. |
| [`<captions>`](./captions.md) | A styled, timed transcript of the enclosing scene (or of a transcript file). |
| [`<adjustmentLayer>`](./adjustment-layer.md) | Draws nothing; its transform composes onto the clip directly below it, for as long as its own clip lasts. |
| [`<html>`](./html.md) | A rect whose paint is real, reactive HTML drawn into the box by the browser. |
| [`<surface>`](./surface-paint.md) | A rect whose paint is a canvas your `ref` draws into, sampled every frame. |

## Paints

Children of a node, stacked in document order over its intrinsic fill. See [paints.md](./paints.md).

| Element | What it is |
| ------- | ---------- |
| `<solidPaint>` | A solid color; what the `fill` prop is shorthand for. |
| `<linearGradientPaint>` / `<radialGradientPaint>` | A gradient; takes `<colorStop>` children. |
| `<colorStop>` | One gradient stop. Valid only inside a gradient paint. |
| `<imagePaint>` / `<videoPaint>` | Media painted into another element's box — a rect or a text filled with a picture. |
| [`<htmlPaint>`](./html.md) | The paint form of `<html>`. |
| [`<surfacePaint>`](./surface-paint.md) | The paint form of `<surface>`. |
| [`<shaderPaint>`](./shader-paint.md) | A WGSL fragment shader over the media paint below it, or procedural where there is none. |

## Styles and motion

Sub-entity children of the node (or paint) that holds them. See [styles.md](./styles.md), [animations.md](./animations.md), [keyframes.md](./keyframes.md).

| Element | What it is |
| ------- | ---------- |
| `<stroke>` | An outline of the parent's box or glyphs. Several stack. |
| `<shadow>` | A drop shadow beneath the parent's silhouette. Several stack. |
| `<effect>` | A CSS-style filter over the parent's rendered pixels. Several stack. |
| `<animation>` | One preset in/out animation of the node holding it. |
| `<keyframeTrack>` | The keyframes of one prop of the element holding it. |
| `<keyframe>` | One keyframe of the track holding it. |

User-defined components are ordinary Solid components; they compose the elements above and carry no runtime cost. Only the elements above produce entities.

## Coordinates and sizing

- Coordinates are **pixels relative to the parent's box**, origin top-left. No percentages, no layout keywords; explicit numbers until the layout engine lands.
- `x` and `y` default to `0`. **Size defaults are per element**, not inherited from the parent:

| Element | Default box |
| ------- | ----------- |
| `<video>`, `<image>`, `<adjustmentLayer>` | 1920 × 1080 |
| `<scene>` | required — the frame's own size |
| `<rect>`, `<html>`, `<surface>` | 100 × 100 |
| `<audio>` | 500 × 150 (the waveform box on the canvas) |
| `<rect mask>` | 500 × 500 |
| `<text>` | fits its glyphs |
| `<captions>` | the preset's — it lays out the caption block against the scene's frame |
| `<group>`, `<sequence>` | fits its children |

- A `<text>` given neither `width` nor `height` sizes itself to what it says; giving it either fixes the box and wraps into it.
- `<group>` and `<sequence>` never take a size: theirs is the union of their children's.
- How media pixels map into the box is controlled by `objectFit` (default `"cover"`), never by the box itself. A generated asset's placeholder therefore always has a definite size, even before the asset exists.

## Common props

Every node accepts:

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `id` | `string` | stamped | How the element is addressed — by the editor writing back to it, by `dapi capture`, by [`syncTo`](./audio-sync.md). Written into your source if you leave it out (see [module.md](./module.md#ids)). |
| `ref` | `SceneNode` variable or `(node: SceneNode) => void` | none | SolidJS-style ref; receives the element's node when it is created. For `<surface>`/`<surfacePaint>` the node's `element` is the backing canvas (see [surface-paint.md](./surface-paint.md)). |
| `name` | `string` | none | Human-readable node name; what labels the node in the editor. |
| `x`, `y` | `number` | `0` | Position relative to the parent, px. |
| `offsetX`, `offsetY` | `number` | `0` | Render-time translation on top of `x`/`y`, px; moves the drawn content without changing the layout box (the channel the slide animations drive). Subpixel values are kept. |
| `width`, `height` | `number` | per element | Box size, px — see the table above. |
| `keepAspectRatio` | `boolean` | absent | Locks the box to its authored proportions: resizing one bound (an editor handle, a layout row) drives the other so the ratio `width`:`height` has is kept — or, with neither authored, the ratio the box currently has. |
| `rotation` | `number` | `0` | Rotation in degrees. |
| `scale` | `number` | `1` | Uniform scale about the box origin. Overrides `scaleX`/`scaleY` while set. |
| `scaleX`, `scaleY` | `number` | `1` | Per-axis scale. |
| `opacity` | `number` | `1` | `0`–`1`; out-of-range values clamp, like CSS. |
| `cornerRadius` | `number` | `0` | Uniform corner radius, px. |
| `cornerRadiusTopLeft`, `cornerRadiusTopRight`, `cornerRadiusBottomRight`, `cornerRadiusBottomLeft` | `number` | `cornerRadius` | Per-corner radius, px; a corner without one takes `cornerRadius`, so `cornerRadius={20} cornerRadiusTopLeft={0}` rounds three corners. |
| `blendMode` | `BlendMode` | `"sourceOver"` | How the element composites over what is below it: the canvas blend modes, camelCase — `multiply`, `screen`, `overlay`, `darken`, `lighten`, `colorDodge`, `colorBurn`, `hardLight`, `softLight`, `difference`, `exclusion`, `hue`, `saturation`, `color`, `luminosity`. |
| `hidden` | `boolean` | absent | Excludes the element from rendering (and its audio from the mix) without removing it: it keeps its place in the timeline and its children. |
| `start`, `end`, `sourceIn`, `sourceOut` | `Time` | see [timing.md](./timing.md) | Temporal placement. |
| `playbackRate` | `number` | `1` | Speed multiplier for the node's local time (see [timing.md](./timing.md#playback-rate)). |
| `transition` | `TransitionSpec \| null` | none | Transition into the next clip; direct children of `<sequence>` only (see [transitions.md](./transitions.md)). |

Props are animated by [`<keyframeTrack>`](./keyframes.md) children naming them; preset in/out effects are [`<animation>`](./animations.md) children. No prop takes keyframes inline.

### Editor state

Three more props are written by the editor and read back on the next mount. They are not part of the composition — nothing rendered or exported depends on them — but the source is the document, so a row resized in the timeline has nowhere else to be remembered:

| Prop | Type | Meaning |
| ---- | ---- | ------- |
| `selected` | `boolean` | Whether the editor has the element selected. Absent means not. |
| `clipHeight` | `number` | Height of the element's row in the timeline, px. Absent means the common row height. |
| `expanded` | `boolean` | Whether the timeline shows the element's keyframe rows below its clip. Absent means collapsed. |

Write them or delete them freely; the editor rewrites its own.
