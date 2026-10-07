# Errors

Where each [pipeline](./README.md#pipeline) stage fails, and with what effect:

| Stage | Where it surfaces | Effect |
| ----- | ----------------- | ------ |
| **Compile** (syntax, an unresolved import, a PascalCase composition tag, a control-flow component with no import) | A "Project failed to compile" toast, with the compiler's message; also on the app console ([`logs`](../tools/logs.md)) | Nothing is remounted. The canvas keeps the last good render, so a project in the middle of an edit is never blanked. |
| **Evaluate / mount** (a throw at module scope or during render, a root that is not `<stage>`, a tag the host does not know, an element parented into its own subtree) | A "Project failed to render" toast with the thrown message | The half-built document is disposed — **nothing is left behind** — and the previous render stays on the canvas. |
| **Source resolution** (a path that does not exist, an unreachable URL, an unsupported file) | The element on the canvas, and `source-error` in [`check`](../tools/check.md) | Per element, not per mount: everything else stays mounted and playable. The element is left without its media, carrying the reason — see below. |

Runtime errors are reported against the compiled module. Since types are stripped rather than checked, run `npx tsc --noEmit` in the project folder to catch what the compile will not.

## Failed sources

A source fails only to load: a path that does not exist, a URL that cannot be reached, a file the app cannot decode. The element carries the reason and is drawn with a still dark-red fill in place of its media; [`check`](../tools/check.md) reports it as `source-error` with the message. Nothing is recorded in the library and nothing is written to your file: fix the path or put the asset back, and the next save or open loads it.

## Blank or partial `<html>` content in captures

A composition that looks right in the viewport but captures black, frozen, or partially missing frames is almost always one of four things — check them in this order:

1. **A stateful animation seek.** anime.js records a tween's start values at the tween's *first* render, and captures/exports sample frames out of order — so a tween whose target was written to outside the timeline before its first render bakes that mutated state in as its starting values and replays it at every subsequent frame. Symptom: deterministic but *order-dependent* wrong frames — the same time renders when requested first and comes out wrong when requested after a later frame. See the caveat in [html.md](./html.md): give tweens explicit start values with `{ from, to }`, never write to or reset tween targets between seeks, and derive capture-critical values statelessly from `time()`.
2. **`scale()` on a large or clipped subtree.** The rasterizer renders these as empty (see [html.md limitations](./html.md#requirements-and-limitations)). Symptom: one wrapper's entire subtree missing at every sampled time while siblings render. Fix: translate/opacity animation; `scale` only on small content-sized leaves without inner clips.
3. **Fractional `opacity` nested under fractional `opacity`.** The rasterizer drops the ancestor's whole subtree while its opacity is between 0 and 1 if any descendant carries its own `opacity` < 1 (see [html.md limitations](./html.md#requirements-and-limitations)). Symptom: an element blank at every time its entrance/exit fade is mid-flight, rendering normally the moment the animated opacity reaches exactly 1 — deterministic per time and independent of sampling order. Fix: animate `opacity` on one level only; dim children with `rgba()`/`hsl()` alpha colors.
4. **`Error drawing <HtmlPaint> content: … No cached paint record for element`** in `logs`, or html content missing from the first sampled frame(s) of a capture while later frames render: the offline draw raced the browser's paint snapshot for a freshly mounted host. Engine-side, not a composition bug — until the `whenReady` paint-snapshot fix ships, re-request the affected time or lead the capture with a throwaway frame.
