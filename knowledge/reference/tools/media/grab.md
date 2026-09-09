# media_grab

Decode frames of a video file and write them as PNGs (local render, no credits). By default the frames are merged into contact sheets: up to 12 per image, each cell labelled with its timecode (`08s10f`, zero segments dropped) and drawn as large as fits, so a handful of frames arrives as one high-resolution picture instead of a directory to open one by one (separate: true writes a PNG per frame). Grabs the asset's own pixels, unlike capture which renders the composited node. The recommended tool for understanding a video at the frame level; past ~12 frames prefer media_filmstrip.

| | |
| --- | --- |
| MCP tool | `media_grab` |
| CLI | `dapi media grab <path> [options]` |
| CLI aliases | `dapi media sample` |

## Input

| Field | Type | CLI | Description |
| --- | --- | --- | --- |
| `path` | `string`, required | `<path>` | absolute file path or URL (works with or without an open project), or a library path like `b-roll/clip.mp4` (needs an open project) |
| `times` | `Time[]` | `-t, --times <time...>` | timestamps to grab — seconds ("1.5"), frames ("45f"), or "MM:SS"; negatives count back from the end, so -1 is one second before the end and -1f one frame before it (default: [0]) |
| `count` | `integer` | `-c, --count <n>` | instead of times, grab this many frames evenly spaced across the clip (or across the start/end window) |
| `auto` | `boolean` | `-a, --auto` | scan the clip at 2fps and keep a frame each time the footage settles into a new visual state (transitions are waited out, so picks stay sharp); returns at most count frames (default cap: 30), static footage like screen recordings returns far fewer; requires WebGPU |
| `start` | `Time` | `-s, --start <time>` | with count or auto, start of the window to sample (default: 0) |
| `end` | `Time` | `-e, --end <time>` | with count or auto, end of the window to sample (default: asset duration) |
| `quality` | `"small" \| "medium" \| "large" \| "fullres"` | `-q, --quality <preset>` | frame resolution: small (384x384), medium (768x768), large (1536x1536), or fullres (native); default: as large as the sheet cell allows, or small with separate: true |
| `separate` | `boolean` | `-S, --separate` | write one image per position instead of merging them into contact sheets of up to 12 cells, each labelled with its timecode |
| `perSheet` | `integer` | `--per-sheet <n>` | positions per contact sheet, 1-12; fewer means a larger cell each (default: as many as fit) |
| `uncapped` | `boolean` | `--uncapped` | lift the 100-frame safety cap (grabbing many frames is slow and token-heavy) |
| `output` | `string` | `-o, --output <dir>` | absolute directory to write the PNGs into (default: a fresh directory under the system temp dir) |

## Sampling

Three ways to say which frames, mutually exclusive:

- `times`: explicit timestamps in source time. A negative value counts back from the end of the clip, so `-1` is one second before the end and `-1f` one frame before it.
- `count`: that many frames evenly spaced across the clip, or across the `start`/`end` window, at a fixed interval of `window / count`, starting at the window start.
- `auto`: a scan at 2 fps that keeps a frame each time the picture settles into a new visual state, dropping near-duplicates and waiting out transitions so picks stay sharp. Returns at most `count` frames (default cap 30); static footage such as a screen recording returns far fewer. Needs WebGPU.

`start` and `end` only apply with `count` or `auto`. Like [`capture`](../capture.md), but this grabs the asset's own pixels; `capture` renders the composited node. Renders locally; no credits. Past ~12 frames, [`media_filmstrip`](./filmstrip.md) is the cheaper way to scan a clip.

With `separate`, frames keep their own resolution and alpha, and each file is named after its timecode (e.g. `01s12f.png`). Without an `output` directory the images land in a fresh `dapi-grab-*` directory under the system temp directory, so runs never overwrite each other. Writing into the same directory twice overwrites images whose name matches; with `separate`, requested times that land on the same frame share one file.

## Timecodes

Cell labels, the `timecode` field, and the filenames all use the same stamp, which drops its zero segments: `08s10f` is 8 seconds and 10 frames, `01m05s` is 65 seconds, and the first frame is `0f`. Each segment carries its unit, so nothing is ambiguous once the empty ones are gone. (The rulers [`media_filmstrip`](./filmstrip.md) and [`media_waveform`](./waveform.md) draw stay on fixed-width `HH:MM:SS:FF`, so their ticks line up.)

## Layout

A sheet never exceeds 2576x1456, the largest image a vision model reads at full detail. Within that budget the grid is the one that draws each frame largest, frames are never enlarged past their source resolution, and the last row may be partially filled. Sheets are named after the span they cover, e.g. `0f-08s10f.png`. For 16:9 footage the cell sizes are:

| Frames | Grid | Per-frame |
|---|---|---|
| 1 | 1x1 | 2568x1444 |
| 2-4 | 2x1, 2x2 | 1280x720 |
| 5-9 | 3x2, 3x3 | 850x478 |
| 10-12 | 4x3 | 636x358 |

## Output

One JSON object with one entry per written image: a contact sheet by default, a frame with `separate`.

```ts
{ images: Array<{ timecode: string; path: string }> }   // e.g. { "images": [{ "timecode": "0f-08s10f", "path": "…/0f-08s10f.png" }] }
```

A sheet's timecode is the span it covers; a frame's is its own. Sheets come in time order, and their cells in the order the times were requested in. Over MCP, up to four images of at most a megabyte each also arrive inline.

## Errors

Fails when the path can't be resolved, the asset is not a video, any of `times` is past the asset's duration, the window is empty or `start` is not before `end`, `times` is combined with `count` or `auto`, `start`/`end` are given without `count` or `auto`, `perSheet` is outside 1 to 12 or combined with `separate`, more than 100 frames are requested without `uncapped`, or a PNG can't be written.
