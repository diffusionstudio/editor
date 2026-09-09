# media_filmstrip

Render a grid of thumbnails sampled across the timeline to a PNG (local render, no credits), each row stamped with an HH:MM:SS:FF ruler. A fast, token-efficient video track preview; narrow the window to zoom into a region of interest. Video only (use media_waveform for audio).

| | |
| --- | --- |
| MCP tool | `media_filmstrip` |
| CLI | `dapi media filmstrip <path> [options]` |
| CLI aliases | `dapi media film` |

## Input

| Field | Type | CLI | Description |
| --- | --- | --- | --- |
| `path` | `string`, required | `<path>` | absolute file path or URL (works with or without an open project), or a library path like `b-roll/clip.mp4` (needs an open project) |
| `start` | `Time` | `-s, --start <time>` | start of the window — seconds ("1.5"), frames ("45f"), or "MM:SS" (default: 0) |
| `end` | `Time` | `-e, --end <time>` | end of the window — seconds ("1.5"), frames ("45f"), or "MM:SS" (default: asset duration) |
| `output` | `string` | `-o, --output <path>` | absolute path to write the PNG to (default: a fresh file under the system temp dir) |
| `scale` | `number` | `-x, --scale <factor>` | scale factor for the thumbnails; smaller fits more rows and columns, larger fits fewer (default: 1) |

Frames are sampled at even intervals across the window. Tick labels use `HH:MM:SS:FF` timecode (hours, minutes, seconds, frame within the second) at every zoom level, so labels stay comparable regardless of the window's span; frames count against the video's frame rate. Video only; use [`media_waveform`](./waveform.md) to inspect the audio track.

The overall canvas size stays fixed, so a smaller `scale` (clamped to `0.25`–`4`) fits **more rows and columns** — a denser grid sampling more moments — and a larger one fits fewer but shows more detail each. Without `output` the PNG lands in a fresh file under the system temp directory.

## Output

One JSON object, the absolute path to the written PNG. Over MCP the image also arrives inline when it is under a megabyte.

```ts
{
  path: string,   // e.g. "/tmp/dapi-filmstrip-3f2c1a8e-….png", or the `output` path
}
```

## Errors

Fails when the path can't be resolved, the asset isn't a video, `start`/`end` fall outside the asset or cross (`start` >= `end`), `scale` isn't a positive number, or the PNG can't be written.
