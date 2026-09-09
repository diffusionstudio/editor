# capture

Render single frames of a scene to PNGs — each frame is the frame an export of that scene would encode, drawn offscreen at the scene's own size. By default the positions are merged into contact sheets: up to 12 per image, each cell labelled with its timecode (`08s10f`, zero segments dropped) and rendered as large as fits, so a few positions arrive as one high-resolution picture instead of a directory to open one by one (separate: true writes a PNG per position, at 720p height). The tool for checking composition ("what plays at time T": layout, overlaps, text, timing) and for verifying frames before an export. Scenes only — a single element renders inside its scene, so capture the scene at the times it plays. For a video asset's own full-resolution pixels use media_grab.

| | |
| --- | --- |
| MCP tool | `capture` |
| CLI | `dapi capture <id> [options]` |

## Input

| Field | Type | CLI | Description |
| --- | --- | --- | --- |
| `id` | `string`, required | `<id>` | scene id from the project's JSX, or `file:id` when two files use the same id |
| `times` | `Time[]` | `-t, --times <time...>` | positions to capture, relative to the export's first frame, the workarea's start (0 = the export's frame 0) — seconds ("1.5"), frames ("45f"), or "MM:SS" (default: [0]) |
| `separate` | `boolean` | `-S, --separate` | write one image per position instead of merging them into contact sheets of up to 12 cells, each labelled with its timecode |
| `perSheet` | `integer` | `--per-sheet <n>` | positions per contact sheet, 1-12; fewer means a larger cell each (default: as many as fit) |
| `output` | `string` | `-o, --output <dir>` | absolute directory to write the PNGs into (default: a fresh directory under the system temp dir) |

## Frames

Each frame is **the frame an export of that scene would encode**: the scene is re-rendered from a fresh mount at its own size, position `0` is the workarea's first frame, and the requested positions are evaluated in timeline order, forward only — the way an export advances — so a composition whose look depends on having played (an `<html>` node's own animation state, for instance) captures exactly as it exports.

Scenes only: a single element renders inside its scene, so capture the scene at the times the element plays. To grab a video asset's own pixels instead of a composited frame, use [`media_grab`](./media/grab.md).

With `separate`, each position is rendered at 720p height and named after its timecode (e.g. `01s12f.png`). Without an `output` directory the images land in a fresh `dapi-capture-*` directory under the system temp directory, so runs never overwrite each other. Writing into the same directory twice overwrites images whose name matches; with `separate`, requested times that land on the same frame share one file.

## Timecodes

Cell labels, the `timecode` field, and the filenames all use the same stamp, which drops its zero segments: `08s10f` is 8 seconds and 10 frames, `01m05s` is 65 seconds, and the export's first frame is `0f`. Each segment carries its unit, so nothing is ambiguous once the empty ones are gone.

## Layout

A sheet never exceeds 2576x1456, the largest image a vision model reads at full detail. Within that budget the grid is the one that draws each frame largest, and the last row may be partially filled. Cells render at their own size rather than the flat 720p of `separate`, so a few positions are sharper than a standalone capture and never coarser; a scene smaller than 1080p tall is rendered up to that height, and nothing is rendered beyond it. Sheets are named after the span they cover, e.g. `0f-11s.png`. For a 16:9 scene the cell sizes are:

| Positions | Grid | Per-frame |
|---|---|---|
| 1 | 1x1 | 1920x1080 |
| 2-4 | 2x1, 2x2 | 1280x720 |
| 5-9 | 3x2, 3x3 | 850x478 |
| 10-12 | 4x3 | 636x357 |

Sheets are opaque: a scene's transparent background composites onto flat grey, and the gutters between cells use the same grey.

## Output

One JSON object with one entry per written image: a contact sheet by default, a position with `separate`.

```ts
{ images: Array<{ timecode: string; path: string }> }   // e.g. { "images": [{ "timecode": "0f-01s15f", "path": "/tmp/dapi-capture-3f2c1a8e/0f-01s15f.png" }] }
```

A sheet's timecode is the span it covers; a single position's is its own. Sheets come in timeline order, and their cells in the order the positions were requested in. Over MCP, up to four images of at most a megabyte each also arrive inline.

## Errors

Fails when no project is open (`No project open` — run [`open`](./open.md) first), the id is unknown, the id is ambiguous (two files use it — pass `file:id`), the id names a node that is not a scene (the error names the scene to capture instead), `perSheet` is outside 1 to 12 or combined with `separate`, or a PNG can't be written.
