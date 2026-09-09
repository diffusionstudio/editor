# export

Encode a scene to a video file — the same render the app's export runs, covering the scene's workarea. Settings come from the scene's `diffusion.export.<id>` entry in the project's package.json (the entry the app's export panel writes); a scene without one exports with the defaults (1080p H.264 MP4, AAC audio). The output path's extension picks the container, overriding the configured format. Returns the written path and the settings used. One export runs at a time; progress shows in the app. Only export when asked to: capture is the tool for checking a composition.

| | |
| --- | --- |
| MCP tool | `export` |
| CLI | `dapi export <id> [output]` |

## Input

| Field | Type | CLI | Description |
| --- | --- | --- | --- |
| `id` | `string`, required | `<id>` | scene id from the project's JSX, or `file:id` when two files use the same id |
| `path` | `string` | `[output]` | absolute output file path, ffmpeg-style; its extension picks the container (default: exports/<id>.<format> in the project folder) |

## Rendering

The full render the app's own export runs: the scene re-rendered from a fresh mount at its own size, the workarea from start to end, video and audio, streamed to the output file as it encodes. What [`capture`](./capture.md) shows one frame of, `export` writes all of.

**The settings live in the project, not on the call.** The export is made with the scene's entry in the project's `package.json` — the same entry the app's export panel writes — so a tool export reproduces the in-app one exactly, and the settings version with the project. The call decides only what to export and where to put it; a hand edit to `package.json` is picked up by the running app immediately, no reload needed.

Renders take as long as the scene demands: the CLI waits up to 60 minutes, and an MCP client should give the call a comparable timeout. The app shows the export's progress overlay while it runs, with a working Cancel button; one export runs at a time. Verify frames with [`capture`](./capture.md) and structure with [`check`](./check.md) before spending the render time.

Scenes only: a scene is the unit an export renders, and the error names the scene to export when the id is some other node's.

## Output path

The `path` extension picks the container — `.mp4`, `.webm`, `.ogg` (audio only), `.mov` — overriding the configured format, so the file is always what its name says. A path without one of those extensions is an error. Omitted, the file lands at `exports/<id>.<format>` in the project folder (parent directories are created); an existing file is overwritten. From a shell, a relative path resolves against the working directory.

## Settings

The scene's entry under `diffusion.export.<id>` in the project's `package.json`:

```jsonc
{
  "diffusion": {
    "export": {
      "intro": {
        "format": "mp4",                    // mp4 | webm | ogg | mov
        "video": {
          "enabled": true,                  // false encodes audio only
          "codec": "avc",                   // avc | hevc | vp9 | av1 | vp8
          "bitrate": 12000000,              // bits per second
          "fps": 30,                        // capture rate; default: the project's
          "resolution": 1080                // shorter-side "p" number: 720 | 1080 | 1440 | 2160
        },
        "audio": {
          "enabled": true,
          "codec": "aac",                   // aac | opus
          "sampleRate": 48000,
          "bitrate": 128000
        }
      }
    }
  }
}
```

Every field is optional; the encoder fills what the entry leaves out. A scene without an entry exports with the defaults — 1080p H.264 MP4 with AAC audio, the app's default template. `resolution` scales the scene uniformly until its shorter side reaches the number, so a portrait 1080×1920 scene at `2160` encodes as 2160×3840.

## Output

One JSON object once the file is written:

```ts
{
  path: string;      // absolute path of the written file
  width: number;     // encoded pixel size (0×0 for an audio-only export)
  height: number;
  duration: number;  // seconds encoded (the workarea's length)
  size: number;      // bytes written
  config: {          // the settings the export was made with — the package.json
    format: string;  // entry (or the defaults), with the container the
    video?: {...};   // extension resolved to. Fields the entry left out are
    audio?: {...};   // absent; the encoder used its defaults for them.
  }
}
```

The echoed `config` is the confirmation of what a `package.json` edit actually did: fields of the wrong type are dropped when the entry is read, so a typoed key shows up here as the default it fell back to.

## Errors

Fails when no project is open (`No project open` — run [`open`](./open.md) first), the id is unknown or ambiguous (pass `file:id`), the id names a node that is not a scene (the error names the scene to export instead), the output path lacks a container extension, the entry's format is unknown, the configuration is unencodable on this machine (codec × resolution × bitrate — the error says what to lower), another export is already running, or the export is canceled in the app. A failed or canceled export deletes the partial file.
