# `<text>`

A text node; its children are the glyphs.

```tsx
<text color="#FFFFFF" fontSize={128} fontWeight="bold" width={1920} textAlign="center">
  Hello World
</text>
```

A `<text>` given neither `width` nor `height` **sizes itself to what it says**; giving it either fixes the box, wraps into it, and makes `textAlign` / `textBaseline` mean something. A centered full-frame title is `<text width={1920} height={1080} textAlign="center" textBaseline="middle">…</text>`.

## Props

All [common props](./elements.md#common-props), plus:

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| children | `string` (or expressions resolving to strings) | **required** | The text content, alongside any `<textRange>`, paint, `<stroke>`, `<shadow>`, `<effect>`, `<animation>` and `<keyframeTrack>` children. |
| `color` | `string` | none | The glyph color; any CSS color, alpha ignored (use `opacity`). Drawn beneath any paint children (see [paints.md](./paints.md)); animate it with a `color` [keyframe track](./keyframes.md). A text with neither `color` nor a paint child draws no glyphs. |
| `fontFamily` | `string` | `Inter` | A family available on the machine ([`dapi fonts`](../fonts.md)); see [fonts.md](./fonts.md). |
| `fontSize` | `number` | `16` | Px. |
| `fontWeight` | `number \| "normal" \| "bold"` | `"normal"` | CSS weights `100`–`900`. |
| `fontStyle` | `"normal" \| "italic" \| "oblique"` | `"normal"` | |
| `letterSpacing` | `number` | `0` | Extra space between glyphs, px; negative tightens. |
| `textCase` | `"original" \| "upper" \| "lower"` | `"original"` | Casing applied when drawing; the text itself stays as written. |
| `textAlign` | `"left" \| "center" \| "right"` | `"left"` | Horizontal alignment of glyphs within the box. |
| `textBaseline` | `"top" \| "middle" \| "bottom" \| "alphabetic"` | `"top"` | Vertical alignment within the box: the block anchored to the top or bottom, centered, or (`"alphabetic"`) the first line's baseline at the top of the box. |
| `leading` | `number` | `1` | Line height as a multiple of each line's natural height. |

The text-only [animation types](./animations.md) (`"appearWord"`, `"appearChar"`, `"scramble"`) animate the glyphs themselves.

## `<textRange>`

A style override for a run of the glyphs, a sub-entity like a paint: `start`/`end` address the run by character index into the text as written (before `textCase`), and the rest is what changes inside it. An unset font prop inherits the text's; its own `color`, paints, strokes and shadows replace the text's for those glyphs. Several stack in document order, later ones winning where they overlap. Layout (`textAlign`, `textBaseline`, `leading`) stays the text's.

```tsx
<text fontSize={96} color="#FFFFFF" width={1920} textAlign="center">
  Ship it today
  <textRange start={5} end={7} color="#F43F5E" fontWeight="bold" />
  <textRange start={8} fontStyle="italic" letterSpacing={2}>
    <stroke color="#000000" width={2} />
  </textRange>
</text>
```

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `start` | `number` | **required** | First character of the run, 0-based. |
| `end` | `number` | end of text | One past the last character of the run. |
| `color` | `string` | inherits | The run's glyph color; any CSS color. |
| `fontFamily`, `fontSize`, `fontWeight`, `fontStyle`, `letterSpacing`, `textCase` | as on `<text>` | inherit | Font overrides for the run. |
| children | | | Paint, `<stroke>`, `<shadow>` and `<keyframeTrack>` (a `color` track) children. |
