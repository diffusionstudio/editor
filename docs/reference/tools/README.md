# Tool reference

Diffusion Studio exposes one set of tools, reachable two ways:

- **MCP.** The running app serves an MCP server at `http://127.0.0.1:3274/mcp` (Streamable HTTP). A connected agent gets every tool in `tools/list`, with the descriptions on these pages and its input and output as JSON Schema 2020-12, and instructions that give the path of these docs in the installed app. A client that can only spawn a stdio server can bridge to the URL with a generic proxy such as `mcp-remote`.
- **CLI.** `diffusion`, the command-line client shipped with the app, wraps every tool as a command for shells, scripts and CI. `diffusion <command> --help` prints the same description and the same field help. (`dapi` also works, as an alias.)

Both validate against the same schemas and return the same result, so each tool is documented once, on its own page. The catalog behind all three (server, CLI, these pages) lives in `packages/dapi`.

The JSX code syntax specified in [jsx/](../jsx/README.md) is **pseudo-SVG**, mirroring SVG's shape-and-paint model with the editor's own tags and props rather than the SVG spec. A project is a folder of that JSX, and **the source is the document**: the app compiles the entry file and renders every element into an editable node, and edits made on the canvas are written back to the element that authored them. So the loop is [`open`](./open.md) once, then edit the files — there is no tool that pushes content into the app. What the tools do is read the running app ([`context`](./context.md), [`capture`](./capture.md), [`logs`](./logs.md)), inspect media, and list what a declaration may name.

## Names

A tool is named as MCP lists it, and the CLI spelling follows from the name:

- `_` in a tool name is a space on the command line: `media_grab` is `diffusion media grab`. The `media` group is also `m`.
- A tool's first field is the positional argument: `capture`'s `id` is `diffusion capture <id>`.
- Every other field is an option in kebab-case: `perSheet` is `--per-sheet`, `separate` is `--separate`. Short forms are listed on each page.
- Times are written the same way everywhere: seconds (`1.5`), frames at the project's rate (`45f`), or a clock string (`1:30`, `00:01:30`). Times in **results** are plain seconds.

## Results

Every tool returns one JSON object, its *structured content*. Over MCP that is the result's `structuredContent`, repeated as a text block for clients that ignore structured content; the CLI prints it to stdout, unchanged. Tools that render images (`capture`, `media_grab`, `media_filmstrip`, `media_waveform`, `screenshot`) write PNGs to disk and return their paths; over MCP a result of at most four images, none over a megabyte, also carries them inline as image content, so a contact sheet arrives in context without opening anything.

## Errors

A failure is a sentence written to be read, e.g. `No project open — run open first`. Over MCP it arrives as a tool result with `isError: true`, not as a protocol error; the CLI prints it to stderr and exits `1`. Each page's Errors section lists what the tool fails on; only the delivery differs by surface.

Every tool runs inside the app, so the app has to be running. Over MCP that is a given — the connection is to the app. From a shell, `diffusion open` launches it (macOS and Windows) or surfaces the running instance; every other command prints a launch instruction and exits `1` while the app is down.

## The tools

| Tool | CLI | Does |
| --- | --- | --- |
| [`open`](./open.md) | `diffusion open` | Open project |
| [`context`](./context.md) | `diffusion context` | App context |
| [`capture`](./capture.md) | `diffusion capture` | Capture frames |
| [`check`](./check.md) | `diffusion check` | Check structure |
| [`export`](./export.md) | `diffusion export` | Export scene |
| [`media_probe`](./media/probe.md) | `diffusion media probe` | Probe media |
| [`media_grab`](./media/grab.md) | `diffusion media grab` | Grab frames |
| [`media_transcribe`](./media/transcribe.md) | `diffusion media transcribe` | Transcribe speech |
| [`media_filmstrip`](./media/filmstrip.md) | `diffusion media filmstrip` | Filmstrip preview |
| [`media_waveform`](./media/waveform.md) | `diffusion media waveform` | Waveform preview |
| [`media_listen`](./media/listen.md) | `diffusion media listen` | Listen to audio |
| [`generate`](./generate.md) | `diffusion generate` | Generate media |
| [`job`](./job.md) | `diffusion job` | Generation job |
| [`logs`](./logs.md) | `diffusion logs` | App logs |
| [`screenshot`](./screenshot.md) | `diffusion screenshot` | Window screenshot |
| [`window`](./window.md) | `diffusion window` | App window |
| [`fonts`](./fonts.md) | `diffusion fonts` | Fonts |
| [`report`](./report.md) | `diffusion report` | Report a bug |

How the surface is divided:

- **The project loop.** [`open`](./open.md) a folder, edit its JSX, [`context`](./context.md) for what the source cannot say, [`capture`](./capture.md) and [`check`](./check.md) to verify, [`export`](./export.md) when asked.
- **Media inspection** (`media_*`): a file by path, without adding it to the project. Absolute paths and URLs work with or without an open project; library paths (`b-roll/clip.mp4`) need one.
- **Generation.** [`generate`](./generate.md) runs a model of the Diffusion Studio API (images, video, music, speech, and tools such as upscaling) on the account's credits, or a model on this machine for free — [`sam-2.1`](./media/segment.md) segments and tracks an object in footage, making the mask file a `<mask src>` names; poll [`job`](./job.md) until it has ended, and its files are saved into the library or a directory. The models and their fields are in [models.md](../models.md).
- **What a declaration may name.** [`fonts`](./fonts.md).
- **The app and the machine.** [`logs`](./logs.md), [`screenshot`](./screenshot.md), [`window`](./window.md), [`report`](./report.md).

## Downloading footage

There is no download tool, and none is needed: run **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** from a shell. It handles YouTube, TikTok, Instagram, Vimeo, X, direct media links and most other sites, and a download that lands under the project's `assets/` folder is a library asset (see [jsx/media.md](../jsx/media.md)).

## Shared types

```ts
Asset = { id: string; path: string; type: string }  // asset ids are content hashes; `path` is the library path
Time  = number | `${number}f` | "MM:SS"              // seconds, frames at the project's rate ("45f"), or a clock string; see jsx/timing.md
NodeId = string                                     // an element's `id` in the project's JSX; `file:id` (`intro.tsx:hero`, the file name with its extension) when two files collide
```

Time inputs take the `Time` format unless noted otherwise.
