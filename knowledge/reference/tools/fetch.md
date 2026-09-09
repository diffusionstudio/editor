# fetch

Download a video with yt-dlp (installed separately). Writes files to disk only and returns their paths (a single URL can yield several, e.g. a playlist).

| | |
| --- | --- |
| MCP tool | `fetch` |
| CLI | `dapi fetch <url> [options]` |

## Input

| Field | Type | CLI | Description |
| --- | --- | --- | --- |
| `url` | `string`, required | `<url>` | video or page URL to download |
| `output` | `string` | `-o, --output <path>` | output file path or directory (yt-dlp -o template; default: yt-dlp's default) |
| `format` | `string` | `-f, --format <selector>` | yt-dlp format selector (default: prefer mp4), e.g. "bv*+ba/b" |
| `audio` | `boolean` | `-a, --audio` | extract audio only (yt-dlp -x) |
| `raw` | `string[]` | `-- <yt-dlp flags...>` | raw yt-dlp flags passed through, e.g. ["--sponsorblock-remove", "all"] |

[yt-dlp](https://github.com/yt-dlp/yt-dlp) is not bundled: install it separately (`brew install yt-dlp`, or `pipx install yt-dlp`). The download runs in the app's main process, so no project needs to be open; yt-dlp is looked up on the app's `PATH`, or at `YT_DLP_PATH` in the app's environment when set. Without it the call fails with an install hint before anything is downloaded.

This writes files to disk only; it does not touch the open project. A download becomes an asset by landing under the project's `assets/` folder (see [jsx/media.md](../jsx/media.md)).

## Format

Without `format`, the download prefers mp4/m4a streams and remuxes the result to `.mp4` (`--merge-output-format mp4`), falling back to the best available if no mp4 source exists. `audio` extracts audio only (yt-dlp `-x`) and takes precedence over the mp4 default; an explicit `format` opts out of both.

## Passthrough

`raw` is a list of yt-dlp flags appended verbatim. From a shell they go after `--`:

```sh
dapi fetch https://youtu.be/xyz -f "bv*+ba/b" -- --sponsorblock-remove all --limit-rate 2M
```

## Output

One JSON object (a single URL can yield several files, e.g. a playlist):

```ts
{ paths: string[] }   // absolute paths of the files on disk, after any extraction / rename
```

The resolved path comes from yt-dlp's `after_move:filepath`, so it reflects the real name after audio extraction or renaming, not a guess.

## Errors

Fails when yt-dlp is not installed or not runnable, or when yt-dlp itself fails; its `ERROR` line is the message. Canceling the call kills the download.
