# `dapi media transcribe <path>`

Transcribes the speech in a video or audio asset and returns the timed transcript. Word-level start/end times are in **seconds** (source/content time).

## Input

- `<path>`: a local video or audio file to transcribe in place without adding it to the library, or a project library path (required; library paths need an open project).
- `--transcript <json>`: skip STT and read a transcript JSON file instead (optional). Accepts `MediaTranscribeResult` or an openai-whisper JSON export.
- `--language <code>`: language hint for local whisper when cloud STT is unavailable (optional).
- `--model <name>`: whisper model name (`base`, `small`, …) or a whisper.cpp ggml model path (optional; default from `WHISPER_MODEL` or `base`).

When signed in, transcription runs through the app (cloud STT, cached in memory keyed by file content). **Without a signed-in account**, local file paths fall back to a local whisper install (`whisper` from openai-whisper, or `whisper-cli` from whisper.cpp with `WHISPER_MODEL` pointing at a ggml model). Library paths still require cloud sign-in or `--transcript`.

## Output

One JSON object, the transcript:

```ts
{
  segments: Array<{
    text:  string;      // spoken words only (no silence markers)
    words: Array<{ text: string; start: number; end: number }>;  // seconds
  }>;
}
```

## Errors

Exits non-zero if the path can't be resolved, the asset is not a video/audio asset, cloud STT fails for a reason other than missing auth, no local whisper is installed when offline, or no speech is detected.

When offline without local whisper, stderr explains how to install `whisper` or `whisper-cli` — it does not ask you to sign in without also listing the offline path.
