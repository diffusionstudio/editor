/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  AdjustmentLayer, Audio, Cache, Caption, Computed, FrameRate, Geometry,
  Group, Hidden, IsMask, Opacity, PaintType, Scene, Sequential, Source,
  SourceError, Workarea, framesToSeconds, getIntrinsicPaint, isText,
} from "@diffusionstudio/runtime";

import { resolveNode } from "./nodes";

import type { CheckIssue, CheckRequest, CheckResult } from "@diffusionstudio/cli/channels";
import type { Entity } from "@diffusionstudio/koota";
import type { EditorSession } from "./session";

// Absolute frames, [start, end).
type Interval = { start: number; end: number };

function kindOf(entity: Entity): string {
  if (entity.has(IsMask)) return "mask";
  if (entity.has(Scene)) return "scene";
  if (entity.has(Group)) return entity.has(Sequential) ? "sequence" : "group";
  if (entity.has(AdjustmentLayer)) return "adjustment-layer";
  if (entity.has(Audio)) return "audio";
  if (entity.has(Caption)) return "caption";
  if (isText(entity)) return "text";
  switch (getIntrinsicPaint(entity)) {
    case PaintType.VIDEO: return "video";
    case PaintType.IMAGE: return "image";
    case PaintType.HTML: return "html";
    default: return "shape";
  }
}

// Whether the node itself puts pixels on screen. Containers don't (their
// leaves do), adjustment layers and masks only shape what others draw, and a
// scene's implicit background is exactly what a "black frame" looks like —
// so none of those count as coverage.
function drawsPixels(entity: Entity): boolean {
  return entity.has(Geometry)
    && !entity.has(Scene)
    && !entity.has(Group)
    && !entity.has(AdjustmentLayer)
    && !entity.has(IsMask)
    && !entity.has(Audio);
}

type WalkState = {
  nodes: number;
  byKind: Record<string, number>;
  depth: number;
  issues: CheckIssue[];
  coverage: Interval[];
  /** Frames→seconds on the checked node's own clock (capture --time's). */
  rel: (frames: number) => number;
};

/**
 * One pass over the subtree: count, classify, surface per-node issues, and
 * collect the intervals where something actually draws. `window` is the
 * intersection of every ancestor's visible span — null once an ancestor is
 * hidden, transparent, or out of window, at which point nothing below can
 * contribute pixels (but still counts toward stats and per-node issues).
 */
function visit(entity: Entity, window: Interval | null, depth: number, state: WalkState): void {
  state.nodes += 1;
  const kind = kindOf(entity);
  state.byKind[kind] = (state.byKind[kind] ?? 0) + 1;
  if (depth > state.depth) state.depth = depth;

  const stamp = entity.get(Source)?.value;
  const failure = entity.get(SourceError);
  if (failure) {
    state.issues.push({
      code: "source-error",
      severity: "error",
      node: stamp,
      message: `Source failed to ${failure.generated ? "generate" : "load"}: ${failure.value}`,
    });
  }

  const computed = entity.get(Computed)!;
  let visible = window;

  if (computed.duration === 0) {
    state.issues.push({
      code: "zero-duration",
      severity: "warning",
      node: stamp,
      message: "Zero duration — the node never renders",
    });
    visible = null;
  }

  if (entity.has(Hidden)) visible = null;

  // A keyframed node may animate its opacity up from 0, so only a static 0
  // is called out (and dropped from coverage).
  const animated = (entity.get(Cache)?.keyframeTracks.length ?? 0) > 0;
  if (entity.get(Opacity)?.value === 0 && !animated) {
    state.issues.push({
      code: "transparent",
      severity: "warning",
      node: stamp,
      message: "Opacity is 0 — the node renders fully transparent",
    });
    visible = null;
  }

  if (visible !== null) {
    const start = Math.max(visible.start, computed.start);
    const end = Math.min(visible.end, computed.end);
    if (start >= end) {
      state.issues.push({
        code: "never-visible",
        severity: "warning",
        node: stamp,
        message: `Never visible — plays ${state.rel(computed.start)}s to ${state.rel(computed.end)}s, outside the window its ancestors play`,
      });
      visible = null;
    } else {
      visible = { start, end };
    }
  }

  if (visible !== null && drawsPixels(entity)) state.coverage.push(visible);

  const cache = entity.get(Cache);
  for (const child of cache?.children ?? []) visit(child, visible, depth + 1, state);
  // Masks are nodes worth counting and checking, but they add no pixels.
  for (const mask of cache?.masks ?? []) visit(mask, null, depth + 1, state);
}

/** The spans of `window` no coverage interval touches. */
function findGaps(window: Interval, coverage: Interval[]): Interval[] {
  const sorted = [...coverage].sort((a, b) => a.start - b.start);
  const gaps: Interval[] = [];
  let cursor = window.start;
  for (const { start, end } of sorted) {
    if (start > cursor) gaps.push({ start: cursor, end: Math.min(start, window.end) });
    cursor = Math.max(cursor, end);
    if (cursor >= window.end) break;
  }
  if (cursor < window.end) gaps.push({ start: cursor, end: window.end });
  // Sub-frame slivers are rounding, not black frames.
  return gaps.filter((gap) => gap.end - gap.start >= 1);
}

export function handleCheck(session: () => EditorSession) {
  return async ({ id }: CheckRequest): Promise<CheckResult> => {
    const { world } = session();
    const target = resolveNode(world, id);
    const fps = world.get(FrameRate)?.value ?? 30;

    const computed = target.get(Computed)!;

    // The span the node actually plays: its bounds, narrowed by a workarea
    // when one is set (workarea frames count from the node's start, the way
    // the encoder and playback read them).
    let window: Interval = { start: computed.start, end: computed.end };
    const workarea = target.get(Workarea);
    if (workarea) {
      const start = Math.min(computed.end, computed.start + Math.max(0, workarea.start));
      const end = Math.max(start, Math.min(computed.end, workarea.end ? computed.start + workarea.end : computed.end));
      window = { start, end };
    }

    const rel = (frames: number) => Math.round(framesToSeconds(frames - computed.start, fps) * 1000) / 1000;
    const state: WalkState = { nodes: 0, byKind: {}, depth: 0, issues: [], coverage: [], rel };
    visit(target, window, 0, state);

    const issues: CheckIssue[] = [];
    if (window.end > window.start) {
      if (state.coverage.length === 0) {
        // A group of only audio clips is a legitimate thing to check; an
        // empty visual subtree is not.
        const audioOnly = (state.byKind["audio"] ?? 0) > 0;
        issues.push({
          code: "no-visuals",
          severity: audioOnly ? "warning" : "error",
          message: audioOnly
            ? "No visual content in the subtree — fine for audio-only nodes, black frames otherwise"
            : "No visual content anywhere in the subtree — every frame renders empty",
        });
      } else {
        const gaps = findGaps(window, state.coverage);
        if (gaps.length > 0) {
          const total = gaps.reduce((sum, gap) => sum + (gap.end - gap.start), 0);
          issues.push({
            code: "black-frames",
            severity: "error",
            message: `No visuals scheduled in ${gaps.length} span${gaps.length === 1 ? "" : "s"} totaling ${rel(computed.start + total)}s — likely black frames`,
            ranges: gaps.map((gap) => ({ start: rel(gap.start), end: rel(gap.end) })),
          });
        }
      }
    }
    issues.push(...state.issues);

    return {
      stats: {
        nodes: state.nodes,
        byKind: state.byKind,
        depth: state.depth,
        duration: rel(computed.start + (window.end - window.start)),
      },
      issues,
    };
  };
}
