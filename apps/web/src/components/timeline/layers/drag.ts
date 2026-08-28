/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The geometry of dragging rows to restack and reparent them: where the
 * pointer is in the tree, and what drop that means. The gesture itself
 * lives in the layer context; everything here is pure.
 *
 * It is all read back from the DOM: the rows render flat under
 * `[data-timeline-layers]` in the same depth-first order the timeline index
 * lists them, so pairing the two by position gives every visible row its
 * rect, depth and ancestor chain without the rows registering anything.
 */

import { isGroupLike, isMask, isSequence } from '@diffusionstudio/runtime';
import { NESTED_INDENT_PX } from './config';

import type { Accessor } from 'solid-js';
import type { Entity } from '@diffusionstudio/koota';
import type { TimelineNode } from '@diffusionstudio/runtime';

/** Client X of the insertion dot for a depth-0 drop; each depth steps inwards.
 *  Sits where a row's icon starts, past the chevron column. */
const DOT_CENTER_PX = 20;
/** A container row's edge strips mean "next to", its middle means "into". */
const EDGE_ZONE_MAX_PX = 8;

export type DropTarget =
  | {
      kind: 'line';
      parent: Entity;
      /** The document sibling the layer is inserted before; none appends last. */
      anchor: Entity | undefined;
      /** List-local Y of the insertion line. */
      y: number;
      /** List-local X of the dot's center, one indent step per depth. */
      inset: number;
    }
  | {
      kind: 'inside';
      parent: Entity;
      /** List-local extent of the highlighted row. */
      top: number;
      height: number;
    };

export type LayerDrag = {
  /** The row being dragged, once the pointer has moved far enough to mean it. */
  dragging: Accessor<Entity | null>;
  /** Where the drag would drop right now. */
  target: Accessor<DropTarget | null>;
  /** Arm a drag from a row's pointerdown; it activates past the threshold. */
  begin: (event: PointerEvent, entity: Entity) => void;
};

/** A visible clip row, its place in the tree paired with its place on screen. */
export type FlatRow = {
  node: TimelineNode;
  depth: number;
  /** The row's parent in the document: another row's entity, or the scene. */
  parent: Entity;
  /** Row entities on the path above this one, indexed by their depth. */
  ancestors: Entity[];
  rect: DOMRect;
};

export type GapContext = {
  root: Entity;
  dragged: Entity;
  /** The dragged subtree: nothing in it may become the parent of the drop. */
  forbidden: Set<Entity>;
  /** Masks stack apart from plain layers; anchors must stay in their bucket. */
  draggedIsMask: boolean;
  containerRect: DOMRect;
  /** Client Y just below the last row of the whole list. */
  listBottom: number;
};

/**
 * The visible clip rows in render order, each with its depth and the row
 * entities above it. Sub-item and keyframe rows indent the tree but never
 * hold layers, so they contribute depth without appearing in the list.
 */
export function flattenRows(nodes: TimelineNode[], root: Entity): Omit<FlatRow, 'rect'>[] {
  const out: Omit<FlatRow, 'rect'>[] = [];
  const ancestors: Entity[] = [];

  const walk = (nodes: TimelineNode[], depth: number, parent: Entity): void => {
    for (const node of nodes) {
      if (node.kind === 'geometry') {
        out.push({ node, depth, parent, ancestors: ancestors.slice() });
        ancestors.push(node.entity);
        walk(node.children, depth + 1, node.entity);
        ancestors.pop();
      } else {
        walk(node.children, depth + 1, parent);
      }
    }
  };

  walk(nodes, 0, root);
  return out;
}

/** Client Y just below the last row, sub-item rows included. */
export function getListBottom(layersEl: HTMLElement, containerRect: DOMRect): number {
  for (let el = layersEl.lastElementChild; el !== null; el = el.previousElementSibling) {
    if ((el as HTMLElement).dataset.dropIndicator !== undefined) continue;
    return el.getBoundingClientRect().bottom;
  }
  return containerRect.top;
}

export type RowHit =
  /** The boundary between rows `index - 1` and `index`. */
  | { kind: 'gap'; index: number }
  | { kind: 'inside'; row: FlatRow };

/**
 * What the pointer is over. A container row splits into edge strips that
 * mean "next to it" and a middle that means "into it"; a plain row splits
 * at its midline. The run of sub-item rows under a clip belongs to the gap
 * after it — there is no spot for a layer between a clip and its fills.
 */
export function hitRows(rows: FlatRow[], y: number, forbidden: Set<Entity>): RowHit {
  let index = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.rect.top <= y) index = i;
    else break;
  }

  if (index === -1) return { kind: 'gap', index: 0 };

  const row = rows[index]!;
  const { rect } = row;
  if (y > rect.bottom) return { kind: 'gap', index: index + 1 };

  const entity = row.node.entity;
  const container = (isGroupLike(entity) || isSequence(entity)) && !forbidden.has(entity);

  if (container) {
    const edge = Math.min(EDGE_ZONE_MAX_PX, rect.height * 0.25);
    if (y < rect.top + edge) return { kind: 'gap', index };
    if (y > rect.bottom - edge) return { kind: 'gap', index: index + 1 };
    return { kind: 'inside', row };
  }

  if (y < rect.top + rect.height / 2) return { kind: 'gap', index };
  return { kind: 'gap', index: index + 1 };
}

/**
 * Turn a gap into a drop. One boundary can close several nested groups, so
 * it offers an insertion at every depth between the row below and one level
 * into the row above; the pointer's X picks among them, the way the dot
 * moves inwards as the drop nests deeper.
 *
 * The column reads top-down while the file reads bottom-up, so the anchor —
 * the document sibling the layer is inserted before — is the nearest row
 * *above* the line at the chosen depth, and a line at the top of a parent's
 * children appends last, which renders frontmost.
 */
export function resolveGap(gapIndex: number, rows: FlatRow[], x: number, context: GapContext): DropTarget | null {
  const above = rows[gapIndex - 1];
  const below = rows[gapIndex];
  const lineY = Math.max((below ? below.rect.top : context.listBottom) - context.containerRect.top, 1);

  if (above === undefined) {
    return { kind: 'line', parent: context.root, anchor: undefined, y: lineY, inset: DOT_CENTER_PX };
  }

  // The gap right under an open container doubles as its topmost slot —
  // for group-likes always, and for clips that already stack layers (masks).
  const canEnterAbove =
    above.node.expanded &&
    !context.forbidden.has(above.node.entity) &&
    (isGroupLike(above.node.entity) || above.node.children.some((child) => child.kind === 'geometry'));

  const maxDepth = above.depth + (canEnterAbove ? 1 : 0);
  const minDepth = Math.min(below?.depth ?? 0, maxDepth);
  const desired = Math.round((x - context.containerRect.left - DOT_CENTER_PX) / NESTED_INDENT_PX);

  let best: { parent: Entity; anchor: Entity | undefined; depth: number } | null = null;

  for (let depth = maxDepth; depth >= minDepth; depth--) {
    let parent: Entity;
    let anchor: Entity | undefined;

    if (depth === above.depth + 1) {
      parent = above.node.entity;
    } else {
      const candidate = depth === 0 ? context.root : above.ancestors[depth - 1];
      if (candidate === undefined || context.forbidden.has(candidate)) continue;
      parent = candidate;
      anchor = scanAnchor(rows, gapIndex, depth, parent, context);
    }

    // Deeper wins a tie: iterating downwards, only a strictly closer depth
    // replaces the one found first.
    if (best === null || Math.abs(depth - desired) < Math.abs(best.depth - desired)) {
      best = { parent, anchor, depth };
    }
  }

  if (best === null) return null;

  return {
    kind: 'line',
    parent: best.parent,
    anchor: best.anchor,
    y: lineY,
    inset: DOT_CENTER_PX + best.depth * NESTED_INDENT_PX,
  };
}

/**
 * The document sibling to insert before: the nearest row above the gap at
 * the chosen depth. Restricted to the dragged layer's stacking bucket —
 * masks and plain layers render as separate runs, so an anchor from the
 * other bucket would land the row somewhere the line never was.
 */
function scanAnchor(
  rows: FlatRow[],
  gapIndex: number,
  depth: number,
  parent: Entity,
  context: GapContext,
): Entity | undefined {
  for (let i = gapIndex - 1; i >= 0; i--) {
    const row = rows[i]!;
    if (row.depth < depth) break;
    if (row.depth > depth) continue;
    if (row.parent !== parent) break;
    // The dragged row is about to leave its spot; it cannot be the anchor.
    if (row.node.entity === context.dragged) continue;
    if (isMask(row.node.entity) === context.draggedIsMask) return row.node.entity;
  }

  return undefined;
}
