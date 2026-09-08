# `dapi media transcribe <path>`

Transcribes the speech in a video or audio asset and returns the timed transcript. Word-level start/end times are in **seconds** (source/content time).

## Input

- `<path>`: a local video or audio file to transcribe in place without adding it to the library, or a project library path (required; library paths need an open project).

The whole asset is transcribed once per app session (cached in memory, keyed by file content; an app restart or an edited file re-transcribes).

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

Exits non-zero if the path can't be resolved or the asset is not a video/audio asset, or if no speech is detected in the audio at all (`No speech detected`).
