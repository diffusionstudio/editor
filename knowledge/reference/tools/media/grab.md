# `dapi media grab <path>`

Decodes one or more frames of a video asset at the given times and merges them into **contact sheets**: up to 12 frames per PNG, each cell labelled with its timecode and drawn as large as the sheet allows, so a handful of frames arrives as one high-resolution picture instead of a directory to open one by one. `--separate` writes a PNG per frame instead. Like [`capture`](../capture.md), but grabs the asset's own pixels (unlike `capture`, which renders the composited node). Renders locally; no credits. Past ~12 frames, [`media filmstrip`](./filmstrip.md) is the cheaper way to scan a clip.

## Input

- `<path>`: a local video file to grab frames from in place without adding it to the library, or a project library path (required; library paths need an open project).
- `-t, --time <time...>`: one or more timestamps to grab, `Time` values in source/content time (optional; default `0`). A negative value is an offset back from the end of the clip, so `-1` is one second before the end and `-1f` one frame before it. Order is preserved in the output regardless of the order given. Mutually exclusive with `--count`.
- `-c, --count <n>`: instead of `--time`, grab `n` frames evenly spaced across the clip at a fixed interval of `window / n`, starting at the window start (optional; positive integer).
- `-s, --start <time>`: with `--count`, the start of the window to sample (optional; `Time` value; default `0`).
- `-e, --end <time>`: with `--count`, the end of the window to sample (optional; `Time` value; default the asset duration).
- `-q, --quality <preset>`: per-frame resolution preset (optional). One of `small` (384x384), `medium` (768x768), `large` (1536x1536), or `fullres` (native); each caps the total pixel count while preserving aspect ratio. Defaults to as much detail as the sheet cell can show, or `small` with `--separate`.
- `-S, --separate`: write one PNG per frame instead of merging them into contact sheets (optional). The frames keep their own resolution and alpha, and each file is named after its timecode (e.g. `01s12f.png`).
- `--per-sheet <n>`: frames per contact sheet, 1 to 12 (optional; default as many as fit). Fewer frames per sheet means a larger cell each. Sheets are balanced, so 13 frames become 7 + 6 rather than 12 + 1.
- `--uncapped`: lift the 100-frame safety cap (optional). Without it, requesting more than 100 frames (via `--count` or `--time`) is rejected.
- `-o, --output <dir>`: directory to write the PNGs into (optional; default a fresh `dapi-grab-*` directory in the system temp directory, so runs never overwrite each other). Writing into the same directory twice overwrites images whose name matches; with `--separate`, requested times that land on the same frame share one file.

## Timecodes

Cell labels, the `timecode` field, and the filenames all use the same stamp, which drops its zero segments: `08s10f` is 8 seconds and 10 frames, `01m05s` is 65 seconds, and the first frame is `0f`. Each segment carries its unit, so nothing is ambiguous once the empty ones are gone. (The rulers `filmstrip` and `waveform` draw stay on fixed-width `HH:MM:SS:FF`, so their ticks line up.)

## Layout

A sheet never exceeds 2576x1456, the largest image a vision model reads at full detail. Within that budget the grid is the one that draws each frame largest, frames are never enlarged past their source resolution, and the last row may be partially filled. Sheets are named after the span they cover, e.g. `0f-08s10f.png`. For 16:9 footage the cell sizes are:

| Frames | Grid | Per-frame |
|---|---|---|
| 1 | 1x1 | 2568x1444 |
| 2-4 | 2x1, 2x2 | 1280x720 |
| 5-9 | 3x2, 3x3 | 850x478 |
| 10-12 | 4x3 | 636x358 |

## Output

One JSON object with one entry per written image: a contact sheet by default, a frame with `--separate`.

```ts
{ images: Array<{ timecode: string; path: string }> }   // e.g. { "images": [{ "timecode": "0f-08s10f", "path": "…/0f-08s10f.png" }] }
```

A sheet's timecode is the span it covers; a frame's is its own. Sheets come in time order, and their cells in the order the times were requested in.

## Errors

Exits non-zero if the path can't be resolved, the asset is not a video, any `--time` is past the asset's duration, the `--count` window is empty, `--time` and `--count` are combined, `--start`/`--end` are given without `--count`, `--per-sheet` is outside 1 to 12, more than 100 frames are requested without `--uncapped`, or a PNG can't be written.
