# media_waveform

Render the audio track of a video or audio file as a waveform PNG (local render, no credits) with a timestamp ruler: loudness over time, with silent stretches highlighted in red. A fast, token-efficient audio track preview; the silent spans are also returned as second ranges.

| | |
| --- | --- |
| MCP tool | `media_waveform` |
| CLI | `dapi media waveform <path> [options]` |
| CLI aliases | `dapi media wave` |

## Input

| Field | Type | CLI | Description |
| --- | --- | --- | --- |
| `path` | `string`, required | `<path>` | absolute file path or URL (works with or without an open project), or a library path like `b-roll/clip.mp4` (needs an open project) |
| `start` | `Time` | `-s, --start <time>` | start of the window — seconds ("1.5"), frames ("45f"), or "MM:SS" (default: 0) |
| `end` | `Time` | `-e, --end <time>` | end of the window — seconds ("1.5"), frames ("45f"), or "MM:SS" (default: asset duration) |
| `output` | `string` | `-o, --output <path>` | absolute path to write the PNG to (default: a fresh file under the system temp dir) |
| `scale` | `number` | `-x, --scale <factor>` | scale factor for the thumbnails; smaller fits more rows and columns, larger fits fewer (default: 1) |

Loudness over time is drawn from decoded audio peaks. Tick labels use `HH:MM:SS:FF` timecode (hours, minutes, seconds, frame within the second) at every zoom level, so labels stay comparable regardless of the window's span. For a video, frames count against the video's frame rate; for a standalone audio asset, the ruler counts against a nominal 30 fps.

The overall canvas size stays fixed, so a smaller `scale` (clamped to `0.25`–`4`) fits **more rows and columns** — a denser time axis — and a larger one fits fewer but taller rows. Without `output` the PNG lands in a fresh file under the system temp directory.

## Output

One JSON object: the absolute path to the written PNG plus the silent stretches (the red spans on the waveform) as `[start, end]` second ranges, in absolute seconds (offset by `start` when a window is used). Over MCP the image also arrives inline when it is under a megabyte.

```ts
{
  path: string,   // e.g. "/tmp/dapi-waveform-3f2c1a8e-….png", or the `output` path
  silences: Array<{ start: number, end: number }>,
}
```

## Errors

Fails when the path can't be resolved, the asset has no decodable audio track, `start`/`end` fall outside the asset or cross (`start` >= `end`), `scale` isn't a positive number, or the PNG can't be written.
