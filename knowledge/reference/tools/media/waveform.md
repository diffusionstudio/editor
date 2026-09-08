# `dapi media waveform <path>`

Renders the audio track of a video or audio file as an amplitude **waveform** PNG, written to a file in the system temp directory: loudness over time drawn from decoded audio peaks, with a timestamp ruler. Silent stretches are highlighted in red. Renders locally; no credits. Alias: `wave`.

Tick labels use `HH:MM:SS:FF` timecode (hours, minutes, seconds, frame within the second) at every zoom level, so labels stay comparable regardless of the window's span. For a video, frames count against the video's frame rate; for a standalone audio asset, the ruler counts against a nominal 30 fps.

## Input

- `<path>`: a local video or audio file to preview in place without adding it to the library, or a project library path (required; library paths need an open project).
- `-s, --start <time>`: start of the window to preview, a `Time` value in source/content time (optional; default `0`).
- `-e, --end <time>`: end of the window to preview, a `Time` value (optional; default the asset's duration).
- `-x, --scale <factor>`: scale factor for the waveform (optional; default `1`, clamped to `0.25`-`4`). The overall canvas size stays fixed, so a smaller scale fits **more rows and columns** (a denser time axis) and a larger scale fits fewer but taller rows.
- `-o, --output <path>`: write the PNG here instead of a temp file (optional).

## Output

One JSON object, the absolute path to the written PNG plus the silent stretches (the red spans on the waveform) as `[start, end]` second ranges, in absolute seconds (offset by `--start` when a window is used):

```ts
{
  path: string,   // e.g. "/tmp/3f2c1a8e-....png", or the --output path
  silences: Array<{ start: number, end: number }>,
}
```

## Errors

Exits non-zero if the path can't be resolved, the asset has no decodable audio track, `--start`/`--end` fall outside the asset or cross (`--start` >= `--end`), `--scale` isn't a positive number, or `--output` can't be written.
