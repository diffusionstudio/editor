# Tool reference

Diffusion Studio exposes one set of tools, reachable two ways:

- **MCP.** The running app serves an MCP server at `http://127.0.0.1:3274/mcp` (Streamable HTTP) and on a local socket; `dapi mcp` pipes that socket to stdio for clients that only spawn processes. A connected agent gets every tool in `tools/list`, with the descriptions on these pages, this knowledge base as resources under `dapi://`, and two live resources, `dapi://context` and `dapi://logs`.
- **CLI.** `dapi`, the command-line client shipped with the app, wraps every tool as a command for shells, scripts and CI. `dapi <command> --help` prints the same description and the same field help.

Both validate against the same schemas and return the same result, so each tool is documented once, on its own page. The catalog behind all three (server, CLI, these pages) lives in `packages/dapi`.

The JSX code syntax specified in [jsx/](../jsx/README.md) is **pseudo-SVG**, mirroring SVG's shape-and-paint model with the editor's own tags and props rather than the SVG spec. A project is a folder of that JSX, and **the source is the document**: the app compiles the entry file and renders every element into an editable node, and edits made on the canvas are written back to the element that authored them. So the loop is [`open`](./open.md) once, then edit the files — there is no tool that pushes content into the app. What the tools do is read the running app ([`context`](./context.md), [`capture`](./capture.md), [`logs`](./logs.md)), inspect media, and list what a declaration may name.

## Names

A tool is named as MCP lists it, and the CLI spelling follows from the name:

- `_` in a tool name is a space on the command line: `media_grab` is `dapi media grab`. The `media` group is also `m`.
- A tool's first field is the positional argument: `capture`'s `id` is `dapi capture <id>`.
- Every other field is an option in kebab-case: `perSheet` is `--per-sheet`, `separate` is `--separate`. Short forms are listed on each page.
- Times are written the same way everywhere: seconds (`1.5`), frames at the project's rate (`45f`), or a clock string (`1:30`, `00:01:30`). Times in **results** are plain seconds.

## Results

Every tool returns one JSON object, its *structured content*. Over MCP that is the result's `structuredContent`, repeated as a text block for clients that ignore structured content; the CLI prints it to stdout, unchanged. Tools that render images (`capture`, `media_grab`, `media_filmstrip`, `media_waveform`, `screenshot`) write PNGs to disk and return their paths; over MCP a result of at most four images, none over a megabyte, also carries them inline as image content, so a contact sheet arrives in context without opening anything.

## Errors

A failure is a sentence written to be read, e.g. `No project open — run open first`. Over MCP it arrives as a tool result with `isError: true`, not as a protocol error; the CLI prints it to stderr and exits `1`. Each page's Errors section lists what the tool fails on; only the delivery differs by surface.

Every tool runs inside the app, so the app has to be running. Over MCP that is a given — the connection is to the app. From a shell, `dapi open` launches it (macOS) or surfaces the running instance; every other command prints a launch instruction and exits `1` while the app is down.

## The tools

| Tool | CLI | Does |
| --- | --- | --- |
| [`open`](./open.md) | `dapi open` | Open project |
| [`context`](./context.md) | `dapi context` | App context |
| [`capture`](./capture.md) | `dapi capture` | Capture frames |
| [`check`](./check.md) | `dapi check` | Check structure |
| [`export`](./export.md) | `dapi export` | Export scene |
| [`media_probe`](./media/probe.md) | `dapi media probe` | Probe media |
| [`media_grab`](./media/grab.md) | `dapi media grab` | Grab frames |
| [`media_transcribe`](./media/transcribe.md) | `dapi media transcribe` | Transcribe speech |
| [`media_filmstrip`](./media/filmstrip.md) | `dapi media filmstrip` | Filmstrip preview |
| [`media_waveform`](./media/waveform.md) | `dapi media waveform` | Waveform preview |
| [`media_listen`](./media/listen.md) | `dapi media listen` | Listen to audio |
| [`models`](./models.md) | `dapi models` | Generation models |
| [`voices`](./voices.md) | `dapi voices` | Speech voices |
| [`whoami`](./whoami.md) | `dapi whoami` | Signed-in account |
| [`logs`](./logs.md) | `dapi logs` | App logs |
| [`screenshot`](./screenshot.md) | `dapi screenshot` | Window screenshot |
| [`fonts`](./fonts.md) | `dapi fonts` | Local fonts |
| [`fetch`](./fetch.md) | `dapi fetch` | Fetch video |
| [`report`](./report.md) | `dapi report` | Report a bug |

How the surface is divided:

- **The project loop.** [`open`](./open.md) a folder, edit its JSX, [`context`](./context.md) for what the source cannot say, [`capture`](./capture.md) and [`check`](./check.md) to verify, [`export`](./export.md) when asked.
- **Media inspection** (`media_*`): a file by path, without adding it to the project. Absolute paths and URLs work with or without an open project; library paths (`b-roll/clip.mp4`) need one.
- **What a declaration may name.** [`models`](./models.md), [`voices`](./voices.md), [`fonts`](./fonts.md). Generation itself is declared in the project module (`generate.*`, see [jsx/generate.md](../jsx/generate.md)); no tool generates.
- **The app and the machine.** [`whoami`](./whoami.md), [`logs`](./logs.md), [`screenshot`](./screenshot.md), [`report`](./report.md), and [`fetch`](./fetch.md) for downloads.

## Shared types

```ts
Asset = { id: string; path: string; type: string }  // asset ids are content hashes; `path` is the library path
Time  = number | `${number}f` | "MM:SS"              // seconds, frames at the project's rate ("45f"), or a clock string; see jsx/timing.md
NodeId = string                                     // an element's `id` in the project's JSX; `file:id` when two files collide
```

Time inputs take the `Time` format unless noted otherwise.
