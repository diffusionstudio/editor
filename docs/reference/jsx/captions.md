# Captions

`<captions src>` inside a scene mounts a transcript as a caption node: a styled, timed transcript.

```tsx
<scene name="Talk" width={1920} height={1080}>
  <video src="a-roll/take-3.mp4" width={1920} height={1080} />
  <captions src="transcripts/take-3.srt" preset="whisper" />
</scene>
```

`src` is **required**: a transcript file — `.srt`, `.vtt`, or a transcript `.json` — or an audio or video asset that carries a transcript. It resolves like any other [`src`](./media.md) (library path, asset id, path, URL) and is mounted as it is; `<captions>` does not transcribe its scene. Loading is **asynchronous and non-blocking**: the caption node is on the canvas from the moment the project mounts and its transcript attaches once loaded. A source that fails to load leaves the node carrying the reason (see [errors.md](./errors.md#failed-sources)).

## Props

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `src` | `string` | **required** | The transcript to mount: a transcript file, or an audio or video asset that carries one. |
| `preset` | see below | `"classic"` | Caption style preset. |
| `colors` | `string[]` | preset defaults | Fills the preset's color slots in order; any CSS color, alpha ignored. Ignored by presets without slots. |
| `verticalAlign` | `"top" \| "center" \| "bottom"` | preset default | Vertical placement of the caption block: anchored to the top or bottom safe margin, or centered. Horizontal placement stays with the preset. |
| `offsetX`, `offsetY` | `number` | `0` | Render-time nudge in px on top of the preset placement; subpixel values are kept. A slide animation drives the same channel and wins while it plays. |
| `start`, `end`, `sourceIn`, `sourceOut` | `Time` | full transcript | Trim which stretch of the transcript is captioned, using the same [timing](./timing.md) semantics as media nodes. See [Trimming](#trimming). |
| `id`, `name` | `string` | see [elements.md](./elements.md#common-props) | Address and label. |

`<animation>` children are valid; the text-only types (`"appearWord"`, `"appearChar"`, `"scramble"`) apply.

The preset positions the caption block; `verticalAlign` overrides only its vertical anchor (`whisper` and `cascade` default to `bottom`, all other presets to `center`), and `offsetX`/`offsetY` nudge the drawn result from there.

## Trimming

Captions carry the same [timing](./timing.md) props as media nodes, and the transcript is source content that must stay aligned to the audio — so advance `start` and `sourceIn` together (and `end`/`sourceOut`), never `start` alone. To show only from 15 s onward, set both `sourceIn={15}` and `start={15}`. One node can't skip a gap, so to blank captions out for a middle stretch — e.g. under an overlay — use two nodes that meet at the gap:

```tsx
<captions src="transcripts/take-3.srt" start={0} end={15} sourceIn={0} sourceOut={15} />   {/* before the overlay */}
<captions src="transcripts/take-3.srt" start={20} sourceIn={20} />                         {/* after the overlay */}
```

## Presets

`preset` selects the caption style: the same presets as the editor's caption inspector. Some presets expose **color slots**, filled in order by the `colors` prop; a missing or omitted entry falls back to the slot's default.

| Preset | Style | Color slots (defaults) |
| ------ | ----- | ---------------------- |
| `"classic"` (default) | Simple one word captions, first choice for vertical content | none |
| `"whisper"` | Small, wide, understated line shown in ~2 s phrases, first choice for landscape content | none |
| `"cascade"` | Light text in the lower left; words appear progressively as they are spoken | none |
| `"spotlight"` | Bold italic centered line; the spoken word lights up in the highlight color | 1: highlight (`#24D5FF`) |
| `"paper"` | Centered two-line block; the line being spoken is emphasized with a heavier weight. | none |
| `"guinea"` | Uppercase display text; the spoken word enlarges and cycles through the three colors. | 3: `#F55353`, `#FEB139`, `#F6F54D` |
| `"stark"` | Heavy uppercase text blended into the footage with a difference blend. | none |
