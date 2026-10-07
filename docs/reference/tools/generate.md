# generate

Start a job on a generative model — images, video, music, sound effects, speech, and tools such as background removal, upscaling, transcription and analysis on the Diffusion Studio API, and object segmentation and tracking ([`sam-2.1`](./media/segment.md)) on this machine — and return the job at once, with its estimated run time and the credits it costs. Poll [`job`](./job.md) with its id until it has ended; the files it made are then saved and their paths returned. With [`estimate`](#estimating), nothing starts: the answer is only what the job would cost and how long it would run. API models need a signed-in account and spend its credits; [local models](../models.md#local) run on the GPU, free, and need no account.

| | |
| --- | --- |
| MCP tool | `generate` |
| CLI | `diffusion generate <model> [fields] [options]` |
| CLI aliases | `diffusion gen` |

## Input

The input is the model's request — `model` plus that model's fields — with two fields of the tool's own. Every model and the fields it takes are listed in [models.md](../models.md).

| Field | Type | CLI | Description |
| --- | --- | --- | --- |
| `model` | `string`, required | `<model>` | the model to run, one of the ids in [models.md](../models.md) |
| *the model's fields* | | `[fields]`, `-p, --prompt <text>` | `prompt`, `images`, `aspectRatio`, `duration`, `voice`, … as the model takes them. On the CLI one JSON object; `--prompt` sets `prompt` without JSON quoting |
| `output` | `string` | `-o, --output <path>` | file the result is saved as: a library path like `b-roll/fox.png` (needs an open project) or an absolute path; its extension is corrected to what the model made, several files are numbered (`fox-1.png`, `fox-2.png`), and a file already there is replaced (default: the library's root under the API's name with a project open, its files under `assets/`; else a fresh directory under the system temp dir). On the CLI a path starting with `.` resolves against the working directory. |
| `maxCredits` | `number` | `--max-credits <n>` | refuse to start the job if it costs more credits than this |
| `estimate` | `boolean` | `--estimate` | don't start the job: answer with only its `credits` and `etaSeconds`, spending nothing (see [Estimating](#estimating)) |

An API model's fields are not checked here: they go to the API as given, and the API answers a request it cannot run with what to fix (`invalid-input`, e.g. an aspect ratio the model does not offer). Each model narrows its kind's bounds, so read its entry in [models.md](../models.md) rather than guessing. A [local model](../models.md#local)'s fields are checked by the app, the same way, before its job starts.

## Files

Where a field takes a file (`images`, `startFrame`, `endFrame`, `image`, `video`, `audio`, `media`), put a `{ "path": … }` object: an absolute path or URL (with or without an open project), or a library path like `b-roll/clip.mp4` (needs an open project). The file is uploaded before the job starts — once per file, however many jobs name it — and the reference becomes the API's own; in an `audio` field only its sound is sent, so a video's picture stays on the machine; a local model reads it in place. The API's references (`{ "kind": "asset", "id" }`, `{ "kind": "url", "url" }`) pass through unchanged. On the CLI a `path` that exists relative to the working directory is sent as its absolute path.

```json
{
  "model": "nano-banana-pro",
  "prompt": "The fox from the first image in the snowy forest of the second, golden hour",
  "images": [{ "path": "/Users/me/refs/fox.png" }, { "path": "b-roll/forest.jpg" }],
  "aspectRatio": "16:9",
  "resolution": "2K"
}
```

```bash
diffusion generate flux-2-klein --prompt "A red fox at dawn, misty meadow, telephoto"
diffusion generate nano-banana-pro --prompt "The fox in the forest" '{"images":[{"path":"./fox.png"},{"path":"./forest.jpg"}],"aspectRatio":"16:9"}'
diffusion generate veo-3.1-fast --prompt "The fox turns and runs into the trees" '{"startFrame":{"path":"./fox.png"},"duration":6}' -o ./fox-run.mp4
diffusion generate elevenlabs-v3 --prompt "Welcome back to the channel." '{"voice":"JBFqnCBsd6RMkjVDRZzb"}'
diffusion generate bria-rmbg-2.0 '{"image":{"path":"./fox.png"}}'
```

## Estimating

With `estimate`, the request is priced instead of run: no job starts, no credits are spent, and the answer is the job's price and run time alone. Ask before a job whose price matters — a long video, a large `count`, a tool priced by its input's length — or to compare models for the same request.

```bash
diffusion generate veo-3.1-fast --prompt "The fox turns and runs into the trees" '{"duration":8}' --estimate
# prints { "credits": …, "etaSeconds": … }
```

Files (`{ "path": … }`) are uploaded first, as for a job, since a tool such as `universal-3.5-pro` or `bytedance-upscaler` is priced by the length of its input; starting the job afterwards reuses the upload. `output` and `maxCredits` are ignored. A [local model](../models.md#local) costs `0`, its `etaSeconds` planned from the file as its job would be. An API model still needs a signed-in account.

## Where the files go

`output` names the file the result is saved as, chosen when the job starts:

- **The extension is the model's.** What a model makes decides the type, so an extension that does not match is replaced and a missing one is added: `fox.jpg` becomes `fox.png` when the model made a PNG, `clips/run` becomes `clips/run.mp4`. Read the returned `path`, not the one you asked for.
- **Several files are numbered.** A job that makes more than one (an image `count` above 1) saves `fox-1.png`, `fox-2.png`, …; a single file is saved at the path itself.
- **A library path** (`b-roll/fox.png`, needs an open project) puts the file into the project's library, under `assets/`, named by `src` like any other asset, and notes the job it came from, as the app's own generations do. A file the project made already at that path is replaced, and everything naming it shows the new one; a file linked from elsewhere on disk is never written over, and the result gets a free name next to it instead.
- **An absolute path** saves the file there, replacing a file already there.
- **Left out**, the file goes into the open project's library at its root under the API's name (`red-fox-at-dawn.png`, numbered if taken), or where a local model files its own (`sam-2.1`: `masks/<video>/Tracking <n>.mask`); with no project open, into a fresh directory of the job's own under the system temp dir, as [`media_transcribe`](./media/transcribe.md) and the other inspection tools do.

The files are saved by the first [`job`](./job.md) call that sees the job succeed (a local model's library files as soon as it does); later calls return the same paths. A file an API model made that went into the library records the job in `assets.yml` (its `job` field), so what made it can be looked up later.

## Output

With `estimate`, `{ credits, etaSeconds }` and nothing else. Otherwise, the API's job, as it is when the call returns — almost always `queued`; a local model's quick work, such as a `sam-2.1` preview, already ended — and the same shape [`job`](./job.md) returns. Every field is the API's, passed through unchanged, except that each file in `assets` has its download `url` replaced by where it was saved. The fields to act on:

```ts
{
  id: string;                         // for `job`
  status: string;                     // queued, running → succeeded, failed or canceled; stop polling once it has ended
  etaSeconds: number;                 // estimated seconds the model runs for
  etaRemainingSeconds: number | null; // estimated seconds left while running
  credits: number;                    // charged; refunded if the job fails or is canceled
  error: { code: string; message: string } | null;  // why it failed or was canceled
  progress?: number | null;           // a local model's job: 0..1 through its current `phase`
  details?: object;                   // a local model's job: what it found, model by model (see models.md)
  assets: Array<{                     // the files it made, empty until it succeeds
    path: string;                     // absolute path of the saved file
    src?: string;                     // its library path, for `src`, when it went into the library
    // …and the API's metadata: filename, mimeType, size, width/height, duration
  }>;
}
```

## Errors

- `sign-in-required` — an API model, and the app is not signed in to a Diffusion Studio account.
- `invalid-input` — the API (or, for a local model, the app) rejected the request; the message names the field and what it takes.
- `no-project` — `output` or a file is a library path and no project is open.
- `not-found` — a `{ path }` names no file.
- Not enough credits for the job (or more than `maxCredits`): the message says so.
