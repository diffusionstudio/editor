# `dapi media listen <path>`

Puts a multimodal model in front of an audio track and returns its answer. With no prompt it returns a general description of what is heard; with `--prompt` it answers that question about the audio (e.g. "who is speaking?", "what music is playing?", "summarize what is said"). Accepts an audio file or a video, but only the audio track is analyzed by default. Alias: `watch`.

## Input

- `<path>`: a local audio or video file to analyze in place without adding it to the library, or a project library path (required; library paths need an open project).
- `-p, --prompt <str>`: question or instruction about the audio (optional; defaults to a general description).
- `-s, --start <time>`: start of the segment to analyze, a `Time` value (optional; default `0`). Timestamps in the analysis are relative to this point.
- `-e, --end <time>`: end of the segment to analyze, a `Time` value (optional; default the asset's duration).
- `--keep-video`: for a video asset, keep the video track instead of stripping it to audio, so the model can analyze what is on screen (optional; default off). Expensive: requires a full video upload.

## Output

One JSON object, the model's answer. `start`/`end` echo the analyzed window (in seconds) and are present only when `-s`/`-e` were given:

```ts
{ result: string, start?: number, end?: number }
```

## Errors

Exits non-zero if the path can't be resolved, the asset isn't a video or audio asset, or `--start`/`--end` cross (`--start` >= `--end`).
