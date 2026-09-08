# `dapi fetch <url>`

Downloads a video with [yt-dlp](https://github.com/yt-dlp/yt-dlp). Does not require the app to be running. yt-dlp is not bundled: install it separately (`brew install yt-dlp`, or `pipx install yt-dlp`). If it is not on `PATH`, the command exits `1` with an install hint; set `YT_DLP_PATH` to point at a specific binary.

This writes the file to disk only; it does not touch the open project.

## Arguments

- `<url>`: the video or page URL to download.

## Options

- `-o, --output <path>`: output file path or directory (yt-dlp `-o` template). Default: yt-dlp's own default template in the current directory.
- `-f, --format <selector>`: yt-dlp format selector, e.g. `"bv*+ba/b"`. Default: prefer mp4/m4a streams and remux the result to `.mp4` (`--merge-output-format mp4`), falling back to the best available if no mp4 source exists.
- `-a, --audio`: extract audio only (yt-dlp `-x`). Takes precedence over the mp4 default.

## Passthrough

Forward raw yt-dlp flags after `--`; they are appended verbatim:

```sh
dapi fetch https://youtu.be/xyz -f "bv*+ba/b" -- --sponsorblock-remove all --limit-rate 2M
```

## Output

One JSON object (a single URL can yield several files, e.g. a playlist):

```ts
{ paths: string[] }   // absolute paths of the files on disk, after any extraction / rename
```

Download progress is rendered by yt-dlp on stderr while the command runs.

## Notes

- The resolved path comes from yt-dlp's `after_move:filepath`, so it reflects the real name after audio extraction or renaming, not a guess.
- Exit code is `0` on success; on failure the command surfaces yt-dlp's exit code and prints its stderr.
