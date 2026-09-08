# `dapi media probe <path>`

Reads the container and per-track technical metadata of an asset; like `ffprobe`, but demuxed locally with mediabunny. Reports the container format, duration, metadata tags, and every track's codec parameters without decoding any media. Reads locally; no credits.

## Input

- `<path>`: a local file to probe in place without adding it to the library, or a project library path (required; library paths need an open project). Any asset type is accepted.

## Output

One JSON object. The shape is **not yet stable**: it reports whatever mediabunny surfaces about the container and its tracks. Packet stats (frame rate, bitrate, packet count) are estimated from a leading sample of packets, so they are fast but approximate. Assets mediabunny can't demux (images, transcripts) don't error; they report file-level info only, with `format: null` and no tracks.

## Errors

Exits non-zero if the path can't be resolved.
