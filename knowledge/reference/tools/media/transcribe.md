# media_transcribe

Transcribe the speech in a video or audio file and return the timed transcript, with word-level start/end times in seconds. Commonly useful for footage with speakers (talking head, interview), where the word times let you cut on a line. A transcript marks only speech; the gaps are not necessarily silent (music, score, applause).

| | |
| --- | --- |
| MCP tool | `media_transcribe` |
| CLI | `dapi media transcribe <path>` |

## Input

| Field | Type | CLI | Description |
| --- | --- | --- | --- |
| `path` | `string`, required | `<path>` | absolute file path or URL (works with or without an open project), or a library path like `b-roll/clip.mp4` (needs an open project) |

Times are in **seconds** of source/content time. The whole asset is transcribed once per app session (cached in memory, keyed by file content; an app restart or an edited file re-transcribes).

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

Fails when the path can't be resolved, the asset is not a video/audio asset, or no speech is detected in the audio at all (`No speech detected`).
