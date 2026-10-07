# sam-2.1

SAM 2.1 segments an object in a video and tracks it through the footage, making the mask file (`.mask`) a [`<mask src>`](../../jsx/styles.md#mask) names — the file the editor's object mask tool makes. It runs in the app, on this machine's GPU: no account, no credits. Like every [local model](../../models.md#local), its job is polled with [`job`](../job.md) and lasts only as long as the app.

| | |
| --- | --- |
| Model | `sam-2.1`, run with [`generate`](../generate.md) |
| CLI | `diffusion generate sam-2.1 '<fields>' [-o <path>]` |

## Input

`model: "sam-2.1"` plus these fields; `output` is [`generate`](../generate.md#where-the-files-go)'s.

| Field | Type | Description |
| --- | --- | --- |
| `video` | `{ path }`, required | the footage |
| `time` | `Time`, required | the frame the prompts are placed on, in source time — seconds (`"1.5"`), frames (`"45f"`), or `"MM:SS"` |
| `points` | `{ x, y }[]` | points on the object, each in 0..1 of the frame |
| `exclude` | `{ x, y }[]` | points on what is not the object, to take it out of the mask |
| `box` | `[x0, y0, x1, y1]` | a box around the object, in 0..1 of the frame |
| `preview` | `boolean` | segment only the frame at `time` and make no mask: for checking a prompt before tracking |
| `start` | `Time` | start of the span to track (default: 0) |
| `end` | `Time` | end of the span to track (default: the file's end) |
| `size` | `string` | the model's size, from the table below (default: `tiny`) |

| Size | | Download | Per tracked frame |
| --- | --- | --- | --- |
| `tiny` | fastest; the default | 83 MB | about 0.25 s |
| `small` | | 112 MB | about 2 s |
| `base-plus` | | 183 MB | about 2.6 s |
| `large` | finest edges, best on small objects | 475 MB | about 4.5 s |

## Prompting

A prompt needs at least one point on the object or a box around it; `exclude` points only take things away. Coordinates are fractions of the frame as it displays (rotation applied, x right, y down), the same space [`grab`](./grab.md) frames are drawn in. A box is usually the most reliable first prompt: draw it around the object as seen in a grabbed frame. When the mask spills onto something next to the object, add an `exclude` point on that thing; when it misses part of the object, add a point on the missing part.

With `preview: true`, `generate` segments that frame alone and answers with the job already succeeded: no file, and as `details.image` the frame with everything outside the mask washed magenta, its edge outlined, the prompts drawn (`+n` on the object, `−n` off it, the box dashed) and a 0.1 grid to read coordinates off. The first preview of a frame encodes it, which takes a moment; further previews on the same frame, file and size run the mask decoder alone and return at once. A preview makes no mask, so it takes neither a span nor an `output`.

```bash
diffusion generate sam-2.1 '{"video":{"path":"footage/skater.mp4"},"time":2.4,"box":[0.4,0.2,0.65,0.95],"preview":true}'
diffusion generate sam-2.1 '{"video":{"path":"footage/skater.mp4"},"time":2.4,"box":[0.4,0.2,0.65,0.95],"exclude":[{"x":0.5,"y":0.9}],"preview":true}'
diffusion generate sam-2.1 '{"video":{"path":"footage/skater.mp4"},"time":2.4,"box":[0.4,0.2,0.65,0.95],"exclude":[{"x":0.5,"y":0.9}],"start":2,"end":9}' -o masks/skater.mask
```

## Tracking

Without `preview`, the object is segmented on the prompted frame and followed forward and backward through every frame from `start` to `end`, one mask frame per frame at the project's frame rate (the file's own with no project open), so pass the span the clip actually plays. `time` must lie in the span. The job runs silently — the app shows nothing — and shares the model with the editor's object mask tool: it is `queued` while the tool or an earlier job has the model, then `running`, its `phase` `downloading` on a first use and `tracking` after, with `etaRemainingSeconds` measured from the frames done so far. Closing the project a mask is bound for cancels its job.

Left without an `output`, the mask goes into the open project's library as `masks/<video>/Tracking <n>.mask`, as the object mask tool files its own, or, with no project open, into a directory of the job's own under the system temp dir. The mask carries its recipe (footage, prompt, span, model), so the editor can make it again if its file goes missing. Name it on the clip it was made from, with `details.start` as its `sourceIn`, so it stays on the footage whatever the trim:

```tsx
<video src="footage/skater.mp4" sourceIn={2} width={1920} height={1080}>
  <effect type="opacity" value={1}>
    <mask src="masks/skater.mask" sourceIn={2} />
  </effect>
</video>
```

## Output

The span is in `details` from the start; what was found arrives once the job has succeeded, with a picture — the preview, or a contact sheet of up to 6 tracked frames with their masks — that over MCP also arrives inline, once, with the first poll that sees it.

```ts
details: {
  frameRate: number;  // frames per second the mask holds
  start: number;      // source time of the first masked frame, seconds: the <mask>'s sourceIn
  end: number;        // source time just past the last masked frame, seconds
  frames: number;     // frames masked (1 on a preview)
  image?: string;     // PNG: the prompted frame with its mask on a preview, the contact sheet otherwise
  bbox?: [x0, y0, x1, y1] | null;  // on the prompted frame, the object's bounds in 0..1 of the frame
  area?: number;      // on the prompted frame, the share of the frame the object covers, 0..1
  score?: number;     // on the prompted frame, the object score: at or below 0 the model sees no object
  iou?: number;       // on the prompted frame, the model's estimate of the mask's quality, 0..1
  lost?: [number, number][];  // [start, end) spans, seconds, where no object was found
  weak?: [number, number][];  // [start, end) spans, seconds, where the model rated its mask below 0.5
}
```

`lost` covers occlusion and the object leaving the frame as well as a track that slipped; look at those moments with [`grab`](./grab.md) before trusting or re-prompting them.

## Errors

`generate` refuses the request (`invalid-input`) when no point or box prompts the object, a box's bounds are out of order or outside 0..1, `time` lies outside `start`–`end` or `time` or `start` is past the video's end, a preview is given a span or an `output`, or a field is one the model does not take; and when the path can't be resolved or is not a video. A job fails when the model cannot load (no WebGPU, or the download failed).
