# media_segment

Segment an object in a video with SAM 2.1 and track it through the footage, writing a mask file (`.mask`) that a [`<mask src>`](../../jsx/styles.md#mask) names: the file the editor's object mask tool makes (local model on the GPU, no credits). Prompt the object on the frame at `time` with `points` on it, `exclude` points off it, and/or a `box` around it, all in 0..1 of the frame (x right, y down). `preview: true` segments that frame alone and writes only an image: the frame with the mask tinted and outlined, the prompts drawn, and a 0.1 grid to read coordinates off. Refine the prompts with previews (fast once the frame is encoded), then make the same call without `preview` to track. Tracking covers `start` to `end`, the whole file by default, at roughly 0.25 s a frame with the tiny model and several times that with the larger ones, so pass the span the clip actually plays. With a project open and the mask going into its library, a track runs in the background: the call returns the mask's paths at once with `state: "tracking"`, and [`context`](../context.md) reports its progress, then a contact sheet of tracked frames and the spans where the object was lost or the mask is weak. A mask written elsewhere is tracked before the call returns, with the same findings. The first use of a model downloads it (83 MB for tiny, up to 475 MB for large).

| | |
| --- | --- |
| MCP tool | `media_segment` |
| CLI | `diffusion media segment <path> --time <time> [options]` |
| CLI aliases | `diffusion media mask` |

## Input

| Field | Type | CLI | Description |
| --- | --- | --- | --- |
| `path` | `string`, required | `<path>` | absolute file path or URL (works with or without an open project), or a library path like `b-roll/clip.mp4` (needs an open project) |
| `time` | `Time`, required | `-t, --time <time>` | the frame the prompts are placed on, in source time — seconds ("1.5"), frames ("45f"), or "MM:SS" |
| `points` | `{ x, y }[]` | `-p, --point <x,y>` | points on the object, each { x, y } in 0..1 of the frame; repeat the option for more |
| `exclude` | `{ x, y }[]` | `-x, --exclude <x,y>` | points on what is not the object, to take it out of the mask; each { x, y } in 0..1 of the frame; repeat the option for more |
| `box` | `[x0, y0, x1, y1]` | `-b, --box <x0,y0,x1,y1>` | a box around the object, in 0..1 of the frame |
| `preview` | `boolean` | `--preview` | segment only the frame at `time` and write no mask: for checking a prompt before tracking |
| `start` | `Time` | `-s, --start <time>` | start of the span to track (default: 0) |
| `end` | `Time` | `-e, --end <time>` | end of the span to track (default: the file's end) |
| `model` | `"tiny" \| "small" \| "base-plus" \| "large"` | `-m, --model <size>` | SAM 2.1 size: tiny (fastest), small, base-plus, or large (slowest; finest edges, best on small objects) (default: tiny) |
| `output` | `string` | `-o, --output <path>` | where the mask file goes: a library path like `masks/skater.mask` (needs an open project; a mask already there is replaced, so every `<mask>` naming it follows) or an absolute file path (default: `masks/<video>/Tracking <n>.mask` in the library with a project open, else a fresh file under the system temp dir). On the CLI a path starting with `.` resolves against the working directory. |

## Prompting

A prompt needs at least one point on the object or a box around it; `exclude` points only take things away. Coordinates are fractions of the frame as it displays (rotation applied), the same space [`media_grab`](./grab.md) frames are drawn in. A box is usually the most reliable first prompt: draw it around the object as seen in a grabbed frame. When the mask spills onto something next to the object, add an `exclude` point on that thing; when it misses part of the object, add a point on the missing part.

The loop is preview, look, adjust:

```bash
diffusion media segment footage/skater.mp4 --time 2.4 --box 0.4,0.2,0.65,0.95 --preview
diffusion media segment footage/skater.mp4 --time 2.4 --box 0.4,0.2,0.65,0.95 --exclude 0.5,0.9 --preview
diffusion media segment footage/skater.mp4 --time 2.4 --box 0.4,0.2,0.65,0.95 --exclude 0.5,0.9 --start 2 --end 9 -o masks/skater.mask
```

The first preview of a frame encodes it, which takes a moment; further previews on the same frame, file and model run the mask decoder alone and return at once. A preview writes no mask, so it takes neither a span nor an `output`.

## Tracking

Without `preview`, the object is segmented on the prompted frame and followed forward and backward through every frame from `start` to `end`, one mask frame per frame at the project's frame rate (the file's own with no project open). `time` must lie in the span. Tracking runs silently — the app shows nothing — and shares the model with the editor's object mask tool, so a track waits for the tool's own work to finish first, and tracks run one after another.

**Into the project's library** (a project is open and `output` is a library path or left out), the track runs in the background. The call returns at once with the mask's `path` and `src`, the span it covers, and `state: "tracking"` — no picture and no findings yet. Poll [`context`](../context.md) until the track's row in `masks` (the one whose `src` matches) is `done`: that row carries the findings below and the contact sheet as `image`, and the mask file is in the library from then on. Name it in a `<mask>` once it is done. A `failed` row says why in `error`; closing the project stops its tracks.

```bash
diffusion media segment footage/skater.mp4 --time 2.4 --box 0.4,0.2,0.65,0.95 --start 2 --end 9 -o masks/skater.mask
diffusion context
```

**Anywhere else** (an absolute `output`, or no project open), the call waits for the whole track and returns everything at once, `state: "done"`: the CLI allows it an hour, and an MCP client should give the call a comparable timeout.

The mask carries its recipe (footage, prompt, span, model), so the editor can make it again if its file goes missing. Name it on the clip it was made from, with `start` as its `sourceIn`, so it stays on the footage whatever the trim:

```tsx
<video src="footage/skater.mp4" sourceIn={2} width={1920} height={1080}>
  <effect type="opacity" value={1}>
    <mask src="masks/skater.mask" sourceIn={2} />
  </effect>
</video>
```

## Output

One JSON object:

```ts
{
  image?: string;     // PNG: the prompted frame with its mask on a preview, a contact sheet of up to 6 tracked frames otherwise; absent while a track runs
  path?: string;      // absolute path of the mask file; absent on a preview
  src?: string;       // the mask's library path, for <mask src>; when it goes into the project's library
  state?: "tracking" | "done";  // on a track: "tracking" while it runs in the background, "done" when the mask is written
  model: "tiny" | "small" | "base-plus" | "large";
  frameRate: number;  // frames per second the mask holds
  start: number;      // source time of the first masked frame, seconds: the <mask>'s sourceIn
  end: number;        // source time just past the last masked frame, seconds
  frames: number;     // frames masked (1 on a preview)
  // What was found; absent while a track runs, when context's row reports it instead.
  bbox?: [x0, y0, x1, y1] | null;  // on the prompted frame, the object's bounds in 0..1 of the frame
  area?: number;      // on the prompted frame, the share of the frame the object covers, 0..1
  score?: number;     // on the prompted frame, the object score: at or below 0 the model sees no object
  iou?: number;       // on the prompted frame, the model's estimate of the mask's quality, 0..1
  lost?: [number, number][];  // [start, end) spans, seconds, where no object was found
  weak?: [number, number][];  // [start, end) spans, seconds, where the model rated its mask below 0.5
}
```

`lost` covers occlusion and the object leaving the frame as well as a track that slipped; look at those moments with [`media_grab`](./grab.md) before trusting or re-prompting them. Over MCP the image also arrives inline when it is at most a megabyte.

## Errors

Fails when the path can't be resolved or the asset is not a video, `time` or `start` is past the video's end, no point or box prompts the object, a box's bounds are out of order or outside 0..1, `time` lies outside `start`–`end`, a preview is given a span or an `output`, `output` is a library path with no project open or names something in the library that is not one of the project's masks, `output` has an extension other than `.mask`, the model cannot load (no WebGPU, or the download failed), or the call is canceled. A background track fails on its row in `context` instead.
