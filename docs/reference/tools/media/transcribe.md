# media_transcribe

Transcribe the speech in a video or audio file and write the timed transcript to a JSON file, with word-level start/end times in seconds and speaker labels; returns the file's path and its segment and word counts. Commonly useful for footage with speakers (talking head, interview), where the word times let you cut on a line. A transcript marks only speech; the gaps are not necessarily silent (music, score, applause).

| | |
| --- | --- |
| MCP tool | `media_transcribe` |
| CLI | `diffusion media transcribe <path>` |

## Input

| Field | Type | CLI | Description |
| --- | --- | --- | --- |
| `path` | `string`, required | `<path>` | absolute file path or URL (works with or without an open project), or a library path like `b-roll/clip.mp4` (needs an open project) |
| `output` | `string` | `-o, --output <path>` | absolute path to write the transcript JSON to (default: a fresh file under the system temp dir) |

Times are in **seconds** of source/content time. An `output` naming an existing directory gets a fresh `dapi-transcript-*.json` inside it. The whole asset is transcribed once per app session (cached in memory, keyed by file content; an app restart or an edited file re-transcribes). Every call writes the file again, so a cached transcript returns at once. Only the audio is uploaded: a video's audio track is copied out (or encoded to Opus when its codec has no audio-only container), so the picture never leaves the machine.

## Output

One JSON object, where the transcript went and how large it is:

```ts
{
  path:     string;   // absolute path of the transcript JSON
  segments: number;   // segments in the transcript
  words:    number;   // words across all segments
}
```

The file holds the transcript as indented JSON, so it searches line by line: a grep for a phrase lands on its segment's `text`, with the word times in the lines after it. Search it (grep, jq) or read the part you need rather than loading it whole — a long recording's word timings run to tens of thousands of tokens.

```ts
{
  segments: Array<{
    text:     string;   // spoken words only (no silence markers)
    speaker?: string;   // "A", "B", … when speakers are told apart
    words: Array<{ text: string; start: number; end: number }>;  // seconds
  }>;
}
```

## Errors

Fails when the path can't be resolved, the asset is not a video/audio asset, or no speech is detected in the audio at all (`No speech detected`).
