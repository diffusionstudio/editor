/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createContext, createSignal, onCleanup, useContext, type JSX, type Signal } from "solid-js";
import { useWorld } from "@diffusionstudio/koota-solid";
import { Expanded, getEntityTree, isMask, isSequence } from "@diffusionstudio/runtime";

import { useEditor, useTimelineIndex } from "@/engine/hooks";
import { useTimeline } from "@/context/timeline";
import { resolveSequentialOverlaps } from "@/engine/overlap";
import { assert, clamp } from "@/utils";
import { flattenRows, getListBottom, hitRows, resolveGap } from "./drag";

import type { Entity } from "@diffusionstudio/koota";
import type { DropTarget, FlatRow, GapContext, LayerDrag } from "./drag";

/** How far the pointer travels before a press means a drag, not a click. */
const DRAG_THRESHOLD_PX = 4;
/** Holding the pointer this close to the list's edge scrolls it. */
const AUTO_SCROLL_ZONE_PX = 28;
const AUTO_SCROLL_MAX_STEP_PX = 8;
/** Hovering a collapsed container this long opens it, as dropping into it would. */
const EXPAND_DWELL_MS = 600;

type LayerContextValue = {
  /** The row whose height is being dragged, if any. */
  resized: Signal<Entity | null>;
  /** The row being dragged to a new place in the tree, and where it would drop. */
  drag: LayerDrag;
}

const LayerContext = createContext<LayerContextValue>();

/**
 * Besides sharing gesture state with the rows, this is where dragging them
 * to restack and reparent lives, Figma-style. The rows never move while the
 * pointer is down; an indicator says where the layer would land — a line
 * with a dot for a spot between siblings, a border around a container for a
 * drop inside it — and the document is only written on release, through
 * `editor.reparent`, so the drop is one undo step.
 */
export function LayerContextProvider(props: { children: JSX.Element }) {
  const world = useWorld();
  const editor = useEditor();
  const timeline = useTimeline();
  const index = useTimelineIndex();

  const resized = createSignal<Entity | null>(null);
  const [dragging, setDragging] = createSignal<Entity | null>(null);
  const [target, setTarget] = createSignal<DropTarget | null>(null);

  let pending: { entity: Entity; startX: number; startY: number } | null = null;
  let active: { entity: Entity; forbidden: Set<Entity>; isMask: boolean } | null = null;
  let dwell: { entity: Entity; since: number } | null = null;
  let pointerX = 0;
  let pointerY = 0;
  let dirty = false;
  let raf = 0;

  const begin = (event: PointerEvent, entity: Entity): void => {
    if (pending !== null || active !== null) return;

    pending = { entity, startX: event.clientX, startY: event.clientY };
    pointerX = event.clientX;
    pointerY = event.clientY;

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
    document.addEventListener('keydown', handleKey, true);
  };

  const activate = (entity: Entity): void => {
    active = {
      entity,
      forbidden: new Set(getEntityTree(world, entity)),
      isMask: isMask(entity),
    };
    dirty = true;
    setDragging(entity);
    raf = requestAnimationFrame(tick);
  };

  const handleMove = (event: PointerEvent): void => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    dirty = true;

    if (pending !== null && active === null) {
      const distance = Math.hypot(pointerX - pending.startX, pointerY - pending.startY);
      if (distance >= DRAG_THRESHOLD_PX) activate(pending.entity);
    }
  };

  const handleUp = (): void => {
    const held = active;
    const drop = target();
    cleanup();
    if (held !== null && drop !== null) performDrop(held.entity, drop);
  };

  /** Escape lets go of the layer without dropping it anywhere. */
  const handleKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || active === null) return;
    event.stopPropagation();
    cleanup();
  };

  const cleanup = (): void => {
    document.removeEventListener('pointermove', handleMove);
    document.removeEventListener('pointerup', handleUp);
    document.removeEventListener('keydown', handleKey, true);
    cancelAnimationFrame(raf);

    pending = null;
    active = null;
    dwell = null;
    dirty = false;
    setDragging(null);
    setTarget(null);
  };

  const tick = (): void => {
    raf = requestAnimationFrame(tick);
    if (active === null) return;

    autoScroll();

    // The dwell fires on quiet frames too — holding still is the gesture.
    if (dwell !== null && performance.now() - dwell.since >= EXPAND_DWELL_MS) {
      const entity = dwell.entity;
      dwell = null;
      dirty = true;
      editor.editProperty(entity, 'expanded', true);
    }

    if (!dirty) return;
    dirty = false;
    updateTarget();
  };

  /** Nudges the shared scroll while the pointer holds near either edge. */
  const autoScroll = (): void => {
    const viewport = document.querySelector<HTMLElement>('[data-timeline-layers-viewport]');
    if (!viewport) return;

    const rect = viewport.getBoundingClientRect();
    let step = 0;

    if (pointerY < rect.top + AUTO_SCROLL_ZONE_PX) {
      step = -Math.min(AUTO_SCROLL_MAX_STEP_PX, (rect.top + AUTO_SCROLL_ZONE_PX - pointerY) * 0.2);
    } else if (pointerY > rect.bottom - AUTO_SCROLL_ZONE_PX) {
      step = Math.min(AUTO_SCROLL_MAX_STEP_PX, (pointerY - (rect.bottom - AUTO_SCROLL_ZONE_PX)) * 0.2);
    }

    if (step !== 0) {
      timeline.scrollBy(step);
      dirty = true;
    }
  };

  const updateTarget = (): void => {
    const layersEl = document.querySelector<HTMLElement>('[data-timeline-layers]');
    const viewportEl = document.querySelector<HTMLElement>('[data-timeline-layers-viewport]');
    const { root, layers } = index();

    if (!layersEl || !viewportEl || root === null || active === null) {
      dwell = null;
      setTarget(null);
      return;
    }

    const rowEls = layersEl.querySelectorAll<HTMLElement>('[data-layer-row]');
    const flat = flattenRows(layers, root);

    // The index rebuilding mid-frame can briefly disagree with the DOM; skip
    // the frame rather than pair rows with the wrong rects.
    if (rowEls.length !== flat.length || flat.length === 0) {
      dwell = null;
      setTarget(null);
      return;
    }

    const rows: FlatRow[] = flat.map((row, i) => ({ ...row, rect: rowEls[i]!.getBoundingClientRect() }));
    const containerRect = layersEl.getBoundingClientRect();
    const viewportRect = viewportEl.getBoundingClientRect();
    const y = clamp(pointerY, viewportRect.top, viewportRect.bottom - 1);

    const context: GapContext = {
      root,
      dragged: active.entity,
      forbidden: active.forbidden,
      draggedIsMask: active.isMask,
      containerRect,
      listBottom: getListBottom(layersEl, containerRect),
    };

    const hit = hitRows(rows, y, context.forbidden);

    if (hit.kind === 'inside') {
      const { node, rect } = hit.row;

      // Dropping into a collapsed container is blind; hovering long enough
      // opens it so the drop can aim at a spot inside instead.
      if (node.expandable && !node.expanded) {
        if (dwell?.entity !== node.entity) dwell = { entity: node.entity, since: performance.now() };
      } else {
        dwell = null;
      }

      setTarget({
        kind: 'inside',
        parent: node.entity,
        top: rect.top - containerRect.top,
        height: rect.height,
      });
      return;
    }

    dwell = null;
    setTarget(resolveGap(hit.index, rows, pointerX, context));
  };

  const performDrop = (entity: Entity, drop: DropTarget): void => {
    if (drop.kind === 'line') {
      editor.reparent(entity, drop.parent, drop.anchor);
      return;
    }

    if (!editor.reparent(entity, drop.parent)) return;
    // A sequence keeps its clips on one line; the drop wins the overlaps.
    if (isSequence(drop.parent)) resolveSequentialOverlaps(world, [entity]);
    if (!drop.parent.has(Expanded)) editor.editProperty(drop.parent, 'expanded', true);
  };

  onCleanup(cleanup);

  return (
    <LayerContext.Provider value={{ resized, drag: { dragging, target, begin } }}>
      {props.children}
    </LayerContext.Provider>
  );
}

export function useLayerContext() {
  const context = useContext(LayerContext);
  assert(context, 'useLayerContext must be used within a LayerContextProvider');
  return context;
}
