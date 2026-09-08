# Captions

`<captions />` inside a scene transcribes that scene's audio into a caption node: a styled, timed transcript.

```tsx
<scene name="Talk" width={1920} height={1080}>
  <video src="a-roll/take-3.mp4" width={1920} height={1080} />
  <captions preset="whisper" />
</scene>
```

Transcription is **asynchronous and non-blocking**: the caption node is on the canvas from the moment the project mounts and its transcript attaches once ready. Because it reads the scene's audible mix, it waits until **every other source in the scene has landed** — a generated `voice` or `audio` track is transcribed at its final placement, not at the placeholder. The scene must contain an unmuted, unhidden audio or video source; without one the node carries an [`error`](./errors.md#failed-sources) saying so.

## Bringing your own transcript

Give `src` a transcript file — `.srt`, `.vtt`, or a transcript `.json` — and it is mounted as it is; no transcription runs and no credits are spent. It resolves like any other [`src`](./media.md) (library path, asset id, path, URL), except that `generate.*` is not accepted.

```tsx
<captions src="transcripts/interview.srt" preset="classic" />
```

## Props

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `src` | `string` | none | A transcript file to mount instead of transcribing the scene. |
| `preset` | see below | `"classic"` | Caption style preset. |
| `colors` | `string[]` | preset defaults | Fills the preset's color slots in order; any CSS color, alpha ignored. Ignored by presets without slots. |
| `verticalAlign` | `"top" \| "center" \| "bottom"` | preset default | Vertical placement of the caption block: anchored to the top or bottom safe margin, or centered. Horizontal placement stays with the preset. |
| `seed` | `number` | `0` | Joins the transcript cache key — see [Caching](#caching). Ignored when `src` is set. |
| `offsetX`, `offsetY` | `number` | `0` | Render-time nudge in px on top of the preset placement; subpixel values are kept. A slide animation drives the same channel and wins while it plays. |
| `start`, `end`, `sourceIn`, `sourceOut` | `Time` | full transcript | Trim which stretch of the transcript is captioned, using the same [timing](./timing.md) semantics as media nodes. See [Trimming](#trimming). |
| `id`, `name` | `string` | see [elements.md](./elements.md#common-props) | Address and label. |

`<animation>` children are valid; the text-only types (`"appearWord"`, `"appearChar"`, `"scramble"`) apply.

The preset positions the caption block; `verticalAlign` overrides only its vertical anchor (`whisper` and `cascade` default to `bottom`, all other presets to `center`), and `offsetX`/`offsetY` nudge the drawn result from there.

## Caching

A transcript is cached under **the scene's id and the `seed`**, and the cached asset is reused whenever that pair comes up again — so reopening a project transcribes nothing and consumes no credits.

The audio itself is not part of the key. **Recutting a scene does not re-transcribe it**: to pick up changed audio, bump `seed`. A value used before replays that take from cache; a value that has not been used for this scene transcribes it again, which costs credits.

## Trimming

Captions carry the same [timing](./timing.md) props as media nodes, and the transcript is source content that must stay aligned to the audio — so advance `start` and `sourceIn` together (and `end`/`sourceOut`), never `start` alone. To show only from 15 s onward, set both `sourceIn={15}` and `start={15}`. One node can't skip a gap, so to blank captions out for a middle stretch — e.g. under an overlay — use two nodes that meet at the gap:

```tsx
<captions start={0} end={15} sourceIn={0} sourceOut={15} />   {/* before the overlay */}
<captions start={20} sourceIn={20} />                         {/* after the overlay */}
```

Both read the same cached transcript: two `<captions>` in one scene do not transcribe it twice.

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
