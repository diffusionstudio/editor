# `dapi media filmstrip <path>`

Renders a **filmstrip** of a video to a PNG, written to a file in the system temp directory: a grid of frames sampled at even intervals across the window, each row stamped with a timestamp ruler. Video only; use [`dapi media waveform`](./waveform.md) to inspect the audio track. Renders locally; no credits. Alias: `film`.

Tick labels use `HH:MM:SS:FF` timecode (hours, minutes, seconds, frame within the second) at every zoom level, so labels stay comparable regardless of the window's span. Frames count against the video's frame rate.

## Input

- `<path>`: a local video file to preview in place without adding it to the library, or a project library path (required; library paths need an open project).
- `-s, --start <time>`: start of the window to preview, a `Time` value in source/content time (optional; default `0`).
- `-e, --end <time>`: end of the window to preview, a `Time` value (optional; default the asset's duration).
- `-x, --scale <factor>`: scale factor for the thumbnails (optional; default `1`, clamped to `0.25`-`4`). The overall canvas size stays fixed, so smaller thumbnails fit **more rows and columns** (a denser grid sampling more moments) and larger thumbnails fit fewer but show more detail each.
- `-o, --output <path>`: write the PNG here instead of a temp file (optional).

## Output

One JSON object, the absolute path to the written PNG:

```ts
{
  path: string,   // e.g. "/tmp/3f2c1a8e-....png", or the --output path
}
```

## Errors

Exits non-zero if the path can't be resolved, the asset isn't a video, `--start`/`--end` fall outside the asset or cross (`--start` >= `--end`), `--scale` isn't a positive number, or `--output` can't be written.
