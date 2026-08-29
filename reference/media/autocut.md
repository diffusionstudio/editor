# `dapi media autocut <path>`

Proposes **keep-ranges** for a CapCut-style jump cut by composing [`dapi media waveform`](./waveform.md) silence detection with [`dapi media transcribe`](./transcribe.md) word timings. Does not re-encode or write media — it returns second ranges (and optionally a JSX `<sequence>`) for trimming with `sourceIn` / `sourceOut`.

Dropped spans:

- **Silences** — from the waveform analyzer (same amplitude threshold as `media waveform`), kept only when at least `--silence-min` long.
- **Stutters** — immediate repeated words (`"I I think"`).
- **Fillers** — a small English/Spanish list (`um`, `like`, `you know`, `o sea`, `vale`, …) matched on transcript words and short phrases.

## Input

- `<path>`: a local video or audio file, or a project library path (library paths need an open project).
- `-s, --start <time>`: start of the window to analyze, a `Time` value (optional; default `0`). Passed through to waveform silence detection; transcript words outside the window are ignored.
- `-e, --end <time>`: end of the window (optional; default the asset's duration).
- `--silence-min <seconds>`: drop silences at least this long (optional; default `0.4`). The waveform's amplitude threshold is fixed in the app.
- `--pad <seconds>`: keep this much audio on each side of a cut (optional; default `0.05`).
- `--lang <code>`: filler vocabulary — `en`, `es`, or `all` (optional; default `all`).
- `--jsx`: include a JSX `<sequence>` of `<video>` clips with `sourceIn` / `sourceOut` for each kept span (optional).

Transcription runs once per app session (cached like `media transcribe`) and may use credits when not cached.

## Output

One JSON object:

```ts
{
  duration: number,
  keep: Array<{ start: number, end: number }>,  // source seconds to keep
  removed: {
    silences: Array<{ start: number, end: number }>,
    fillers: Array<{ start: number, end: number }>,
    stutters: Array<{ start: number, end: number }>,
  },
  jsx?: string,  // when --jsx; placeholder width/height 1920×1080
}
```

Times are in **source/content seconds**, the same clock as `transcribe` and `waveform`.

## Errors

Exits non-zero if the path can't be resolved, probe can't read a duration, the asset has no decodable audio, transcription fails (`No speech detected`), or `--start`/`--end`/`--silence-min`/`--pad`/`--lang` are invalid.

## Example

```sh
dapi media autocut interview.mp4 --jsx
```
