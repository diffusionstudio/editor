# media_probe

Read the container and per-track technical metadata of a media file (local read, no credits): container format, duration, tags, and each track's codec params, without decoding. Commonly useful for a quick technical read, e.g. checking codec compatibility or duration before cutting. Packet stats (fps, bitrate) are estimated from a leading sample; images and transcripts report file-level info only.

| | |
| --- | --- |
| MCP tool | `media_probe` |
| CLI | `dapi media probe <path>` |

## Input

| Field | Type | CLI | Description |
| --- | --- | --- | --- |
| `path` | `string`, required | `<path>` | absolute file path or URL (works with or without an open project), or a library path like `b-roll/clip.mp4` (needs an open project) |

Like `ffprobe`, but demuxed locally with mediabunny; any asset type is accepted.

## Output

One JSON object. The shape is **not yet stable**: it reports whatever mediabunny surfaces about the container and its tracks. Packet stats (frame rate, bitrate, packet count) are estimated from a leading sample of packets, so they are fast but approximate. Assets mediabunny can't demux (images, transcripts) don't error; they report file-level info only, with `format: null` and no tracks.

```ts
{
  id: string; name: string; path: string; type: string;
  mimeType?: string;
  size: number;              // bytes
  width?: number; height?: number;
  format: string | null;     // container name; null when the file could not be read as media
  duration?: number;         // seconds
  tags?: Record<string, unknown>;
  tracks: Array<{ id: number; type: string; codec: string | null; language: string; firstTimestamp: number; duration: number; /* … */ }>;
}
```

## Errors

Fails when the path can't be resolved.
