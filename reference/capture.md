# `dapi capture <id> [-t, --time <time...>]`

Renders single frames of a scene at one or more timeline positions and merges them into **contact sheets**: up to 12 positions per PNG, each cell labelled with the timecode of the frame actually rendered and drawn as large as the sheet allows, so a few positions arrive as one high-resolution picture instead of a directory to open one by one. `--separate` writes a PNG per position instead.

Each frame is **the frame an export of that scene would encode**: the scene is re-rendered from a fresh mount at its own size, position `0` is the workarea's first frame, and the requested positions are evaluated in timeline order, forward only — the way an export advances — so a composition whose look depends on having played (an `<html>` node's own animation state, for instance) captures exactly as it exports. The tool for checking composition ("what plays at time T": layout, overlaps, text, timing) and for verifying frames before an export.

Scenes only: a single element renders inside its scene, so capture the scene at the times the element plays. To grab a video asset's own pixels instead of a composited frame, use [`media grab`](./media/grab.md).

## Input

- `<id>`: scene id to capture (required) — the scene's `id` attribute in the project's JSX (e.g. `intro`), or its position in the file when it has none. When two files use the same id, the `file:id` form (`index.tsx:intro`) settles it. Entity numbers are not accepted; they change on every recompile.
- `-t, --time <time...>`: one or more positions to capture, relative to the export's first frame — the workarea's start, so `0` is the export's frame 0 — each a `Time` value (optional; default `0`)
- `-S, --separate`: write one PNG per position instead of merging them into contact sheets (optional). Each is rendered at 720p height and named after its timecode (e.g. `01s12f.png`).
- `--per-sheet <n>`: positions per contact sheet, 1 to 12 (optional; default as many as fit). Fewer positions per sheet means a larger cell each. Sheets are balanced, so 13 positions become 7 + 6 rather than 12 + 1.
- `-o, --output <dir>`: directory to write the PNGs into (optional; default a fresh `dapi-capture-*` directory in the system temp directory, so runs never overwrite each other). Writing into the same directory twice overwrites images whose name matches; with `--separate`, requested times that land on the same frame share one file.

## Timecodes

Cell labels, the `timecode` field, and the filenames all use the same stamp, which drops its zero segments: `08s10f` is 8 seconds and 10 frames, `01m05s` is 65 seconds, and the export's first frame is `0f`. Each segment carries its unit, so nothing is ambiguous once the empty ones are gone.

## Layout

A sheet never exceeds 2576x1456, the largest image a vision model reads at full detail. Within that budget the grid is the one that draws each frame largest, and the last row may be partially filled. Cells render at their own size rather than the flat 720p of `--separate`, so a few positions are sharper than a standalone capture and never coarser; a scene smaller than 1080p tall is rendered up to that height, and nothing is rendered beyond it. Sheets are named after the span they cover, e.g. `0f-11s.png`. For a 16:9 scene the cell sizes are:

| Positions | Grid | Per-frame |
|---|---|---|
| 1 | 1x1 | 1920x1080 |
| 2-4 | 2x1, 2x2 | 1280x720 |
| 5-9 | 3x2, 3x3 | 850x478 |
| 10-12 | 4x3 | 636x357 |

Sheets are opaque: a scene's transparent background composites onto flat grey, and the gutters between cells use the same grey.

## Output

One JSON object with one entry per written image: a contact sheet by default, a position with `--separate`.

```ts
{ images: Array<{ timecode: string; path: string }> }   // e.g. { "images": [{ "timecode": "0f-01s15f", "path": "/tmp/dapi-capture-3f2c1a8e/0f-01s15f.png" }] }
```

A sheet's timecode is the span it covers; a single position's is its own. Sheets come in timeline order, and their cells in the order the positions were requested in.

## Errors

Exits non-zero if no project is open (`No project open` — run `dapi open <dir>` first), the id is unknown, the id is ambiguous (two files use it — pass `file:id`), the id names a node that is not a scene (the error names the scene to capture instead), `--per-sheet` is outside 1 to 12, or a PNG can't be written.
