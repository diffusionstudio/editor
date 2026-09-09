# check

Check a node's subtree for obvious structural mistakes, without rendering (local analysis, no credits): spans where no visual is scheduled (likely black frames), children that never become visible, zero-duration or fully transparent nodes, and assets that failed to load or generate — plus subtree stats (node count by kind, nesting depth, played duration). Times in issue ranges are seconds relative to the node's start — for a scene whose workarea starts at 0, the same clock capture uses. Structural only: a scheduled clip can still render black (dark footage, content smaller than the canvas), so confirm suspicious spans visually with capture.

| | |
| --- | --- |
| MCP tool | `check` |
| CLI | `dapi check <id>` |

## Input

| Field | Type | CLI | Description |
| --- | --- | --- | --- |
| `id` | `string`, required | `<id>` | node id from the project's JSX, or `file:id` when two files use the same id |

## What it can and cannot see

The analysis is structural, from the resolved timeline alone, so it is instant and costs no credits — and it can only say *nothing is scheduled*, not *the frame is black*. A scheduled clip can still render black (dark footage, content smaller than the canvas, a transparent asset); confirm suspicious spans visually with [`capture`](./capture.md) at a time inside the range. Alongside the issues it reports subtree stats — node count by kind, nesting depth, and played duration — so it doubles as a quick structural summary of a scene. The `id` resolves by the same rules as [`capture`](./capture.md)'s.

## What counts as visual coverage

Video, image, HTML, shape, text, and caption nodes draw pixels; their scheduled spans cover the timeline. Groups and scenes are covered only where their descendants draw — a scene's background alone is exactly what a black frame looks like, so it never counts. Audio nodes, masks, and adjustment layers add no pixels; neither does anything hidden, fully transparent, or scheduled outside the window its ancestors play. When a scene has a workarea, coverage is judged against the workarea instead of the full span.

## Output

One JSON object:

```ts
{
  stats: {
    nodes: number;                    // nodes in the subtree, the checked node included
    byKind: Record<string, number>;   // "scene" | "sequence" | "group" | "video" | "image" | "html" | "shape" | "text" | "caption" | "audio" | "mask" | "adjustment-layer"
    depth: number;                    // deepest nesting level below the checked node (0 = no children)
    duration: number;                 // seconds the checked node plays (its workarea, when one is set)
  };
  issues: Array<{
    code: "black-frames" | "no-visuals" | "never-visible" | "zero-duration" | "transparent" | "source-error";
    severity: "error" | "warning";
    message: string;
    node?: string;                    // source stamp of the offending node; absent for subtree-wide issues
    ranges?: Array<{ start: number; end: number }>;  // seconds relative to the node's start — for a scene whose workarea starts at 0, the clock `capture` positions use
  }>;
}
```

## Issues

| Code | Severity | Meaning |
|---|---|---|
| `black-frames` | error | Spans of a frame or more where nothing visual is scheduled; `ranges` lists them |
| `no-visuals` | error* | Nothing in the subtree draws at all (*warning when the subtree holds audio nodes — an audio-only group is legitimate) |
| `never-visible` | warning | A node scheduled entirely outside the window its ancestors play |
| `zero-duration` | warning | A node that spans no frames |
| `transparent` | warning | A node with static opacity 0 (nodes with keyframes are given the benefit of the doubt) |
| `source-error` | error | An asset that failed to load or generate, with the failure message |

## Severity and the shell

Finding issues is not a failure: the result is the same object either way, and the caller reads `issues`. From a shell, `dapi check` additionally exits `1` when an error-severity issue is found (warnings alone stay `0`), so it can gate a script.

## Errors

Fails when the check itself can't run: no project is open, or the id is unknown or ambiguous.
