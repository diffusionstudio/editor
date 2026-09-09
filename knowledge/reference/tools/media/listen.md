# media_listen

Prompt a multimodal model for a semantic analysis of an audio track and return its answer. Shines on audio semantics (the name of the music playing, who is speaking, the spoken content with second-granularity timestamps). Accepts an audio file or a video; of a video only the audio track is analyzed. Needs a signed-in account.

| | |
| --- | --- |
| MCP tool | `media_listen` |
| CLI | `dapi media listen <path> [options]` |

## Input

| Field | Type | CLI | Description |
| --- | --- | --- | --- |
| `path` | `string`, required | `<path>` | absolute file path or URL (works with or without an open project), or a library path like `b-roll/clip.mp4` (needs an open project) |
| `prompt` | `string` | `-p, --prompt <str>` | question or instruction to guide the analysis |
| `start` | `Time` | `-s, --start <time>` | start of the segment to analyze (default: 0); timestamps in the analysis are relative to this point |
| `end` | `Time` | `-e, --end <time>` | end of the segment to analyze (default: media duration) |

With no `prompt` it returns a general description of what is heard; with one it answers that question about the audio (e.g. "who is speaking?", "what music is playing?", "summarize what is said"). See [the prompt guide](../../../guides/prompts/media-listen.md) for prompts that work. Costs credits, and needs a signed-in account ([`whoami`](../whoami.md)).

## Output

One JSON object, the model's answer. `start`/`end` echo the analyzed window (in seconds) and are present only when a window was given:

```ts
{ result: string, start?: number, end?: number }
```

## Errors

Fails when the path can't be resolved, the asset isn't a video or audio asset, `start`/`end` cross (`start` >= `end`), or no account is signed in.
