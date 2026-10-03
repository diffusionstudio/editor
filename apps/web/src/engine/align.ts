/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Align, distribute and tidy the selection: the nodes are moved in device space
 * against the upright box of them all (`WorldBounds`, which the transform
 * system writes), and each move becomes the `x`/`y` a drag would write, in
 * the node's own parent's space. Only nodes directly inside a scene (or
 * top-level ones) take part, as before: a nested node aligns to siblings in
 * its group, which has no box of its own to align against here.
 */

import {
  Geometry,
  Group,
  Position,
  RenderSurface,
  Selected,
  WorldBounds,
  entityWorldMat,
  getCameraScale,
  getParentEntity,
  getParentNode,
  invert2D,
  isScene,
  store,
  transformPoint,
} from "@diffusionstudio/runtime";
import { Or } from "koota";
import { getDocumentEditor } from "./editor";
import { syncKeyframe } from "./keyframes";

import type { Entity, World } from "koota";

export type AlignAction =
  | "align-left"
  | "align-center-horizontal"
  | "align-right"
  | "align-top"
  | "align-center-vertical"
  | "align-bottom";

export type Axis = "x" | "y";

type Box = { minX: number; minY: number; maxX: number; maxY: number };

type Item = { entity: Entity; box: Box };

/** Tidy's spacing, in document units, when the selection has none to read off. */
const DEFAULT_GAP = 40;

/** The selected nodes alignment moves: top-level ones and direct children of scenes. */
export function getAlignableSelection(world: World): Entity[] {
  return [...world.query(Selected, Or(Geometry, Group))].filter((entity) => {
    const parent = getParentNode(entity);
    return parent === null || isScene(parent);
  });
}

function boundsOf(world: World, entity: Entity): Box {
  const bounds = store(world, WorldBounds);
  const eid = entity.id();
  return {
    minX: bounds.minX[eid] ?? 0,
    minY: bounds.minY[eid] ?? 0,
    maxX: bounds.maxX[eid] ?? 0,
    maxY: bounds.maxY[eid] ?? 0,
  };
}

function union(boxes: Box[]): Box {
  return {
    minX: Math.min(...boxes.map((box) => box.minX)),
    minY: Math.min(...boxes.map((box) => box.minY)),
    maxX: Math.max(...boxes.map((box) => box.maxX)),
    maxY: Math.max(...boxes.map((box) => box.maxY)),
  };
}

/**
 * Moves `entity` by a device-space delta: the delta in its parent's space
 * (the stage's is the view) added to its `x`/`y`, rounded like a drag's, and
 * kept in step with any position track.
 */
function moveByWorldDelta(world: World, entity: Entity, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  const position = entity.get(Position);
  if (!position) return;

  const inverse = invert2D(entityWorldMat(world, getParentEntity(entity)));
  const origin = transformPoint(inverse, 0, 0);
  const delta = transformPoint(inverse, dx, dy);
  const editor = getDocumentEditor(world);

  if (dx !== 0) {
    const x = Math.round(position.x + delta.x - origin.x);
    editor.editProperty(entity, "x", x);
    syncKeyframe(world, editor, entity, "x", x);
  }
  if (dy !== 0) {
    const y = Math.round(position.y + delta.y - origin.y);
    editor.editProperty(entity, "y", y);
    syncKeyframe(world, editor, entity, "y", y);
  }
}

/**
 * Aligns every selected node to the edge or center of the selection's box.
 * One node is a no-op: the box is the node.
 */
export function alignSelection(world: World, action: AlignAction): void {
  const entities = getAlignableSelection(world);
  if (entities.length < 2) return;

  const boxes = entities.map((entity) => boundsOf(world, entity));
  const mask = union(boxes);
  const centerX = (mask.minX + mask.maxX) / 2;
  const centerY = (mask.minY + mask.maxY) / 2;

  entities.forEach((entity, index) => {
    const box = boxes[index]!;
    const width = box.maxX - box.minX;
    const height = box.maxY - box.minY;

    let targetMinX = box.minX;
    let targetMinY = box.minY;

    switch (action) {
      case "align-left": targetMinX = mask.minX; break;
      case "align-center-horizontal": targetMinX = centerX - width / 2; break;
      case "align-right": targetMinX = mask.maxX - width; break;
      case "align-top": targetMinY = mask.minY; break;
      case "align-center-vertical": targetMinY = centerY - height / 2; break;
      case "align-bottom": targetMinY = mask.maxY - height; break;
    }

    moveByWorldDelta(world, entity, targetMinX - box.minX, targetMinY - box.minY);
  });
}

/**
 * Spaces the selected nodes evenly along `axis` between the two outermost,
 * in their current order. Needs three: two have nothing between them.
 */
export function distributeSelection(world: World, axis: Axis): void {
  const entities = getAlignableSelection(world);
  if (entities.length < 3) return;

  const horizontal = axis === "x";
  const min = (box: Box) => (horizontal ? box.minX : box.minY);
  const size = (box: Box) => (horizontal ? box.maxX - box.minX : box.maxY - box.minY);

  const sorted = entities
    .map((entity) => ({ entity, box: boundsOf(world, entity) }))
    .sort((a, b) => min(a.box) - min(b.box));
  const mask = union(sorted.map((item) => item.box));

  const total = sorted.reduce((sum, item) => sum + size(item.box), 0);
  const gap = (size(mask) - total) / (sorted.length - 1);

  let cursor = min(mask);
  for (const { entity, box } of sorted) {
    const delta = cursor - min(box);
    moveByWorldDelta(world, entity, horizontal ? delta : 0, horizontal ? 0 : delta);
    cursor += size(box) + gap;
  }
}

/**
 * Groups items into bands along `axis`: sorted by their leading edge, an item
 * joins the open band while its center falls inside that band's first item.
 */
function bands(items: Item[], axis: Axis): Item[][] {
  const min = (box: Box) => (axis === "x" ? box.minX : box.minY);
  const max = (box: Box) => (axis === "x" ? box.maxX : box.maxY);
  const result: { items: Item[]; end: number }[] = [];

  for (const item of [...items].sort((a, b) => min(a.box) - min(b.box))) {
    const center = (min(item.box) + max(item.box)) / 2;
    const band = result[result.length - 1];
    if (band && center < band.end) band.items.push(item);
    else result.push({ items: [item], end: max(item.box) });
  }

  return result.map((band) => band.items);
}

/** The lower median of the positive values; one stray wide gap does not set the spacing. */
function typicalGap(values: number[]): number | undefined {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function offsets(sizes: number[], gap: number, start: number): number[] {
  let cursor = start;
  return sizes.map((size) => {
    const offset = cursor;
    cursor += size + gap;
    return offset;
  });
}

/**
 * Lays the selection out as a grid with even gaps from its top-left corner,
 * in reading order. The layout it already has picks the shape: one row stays
 * a row, a rough grid keeps its column count, and a scatter with no structure
 * to keep becomes a square-ish grid. The gaps are the ones already there
 * between neighbours, each axis on its own, in whole document units.
 */
export function tidySelection(world: World): void {
  const entities = getAlignableSelection(world);
  if (entities.length < 2) return;

  const items = entities.map((entity) => ({ entity, box: boundsOf(world, entity) }));
  const rows = bands(items, "y").map((row) => row.sort((a, b) => a.box.minX - b.box.minX));
  const columnBands = bands(items, "x").length;
  const count = items.length;

  const columns =
    rows.length === 1 ? count
    : rows.length * columnBands <= 2 * count ? columnBands
    : Math.ceil(Math.sqrt(count));

  // Device pixels per document unit.
  const scale = getCameraScale(world) * (world.get(RenderSurface)?.resolution ?? 1);
  const toUnits = (gap: number | undefined) => (gap === undefined ? undefined : Math.round(gap / scale) * scale);

  const gapX = toUnits(typicalGap(rows.flatMap((row) => row.slice(1).map((item, index) => item.box.minX - row[index]!.box.maxX))));
  const gapY = toUnits(typicalGap(rows.slice(1).map((row, index) =>
    Math.min(...row.map((item) => item.box.minY)) - Math.max(...rows[index]!.map((item) => item.box.maxY)))));
  const fallback = DEFAULT_GAP * scale;

  const order = rows.flat();
  const widths = new Array<number>(columns).fill(0);
  const heights = new Array<number>(Math.ceil(count / columns)).fill(0);
  order.forEach(({ box }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    widths[column] = Math.max(widths[column]!, box.maxX - box.minX);
    heights[row] = Math.max(heights[row]!, box.maxY - box.minY);
  });

  const origin = union(items.map((item) => item.box));
  const lefts = offsets(widths, gapX ?? gapY ?? fallback, origin.minX);
  const tops = offsets(heights, gapY ?? gapX ?? fallback, origin.minY);

  // Under half a unit rounds back to where it was: no edit for nothing.
  const settle = (delta: number) => (Math.abs(delta) < scale / 2 ? 0 : delta);

  order.forEach(({ entity, box }, index) => {
    const dx = lefts[index % columns]! - box.minX;
    const dy = tops[Math.floor(index / columns)]! - box.minY;
    moveByWorldDelta(world, entity, settle(dx), settle(dy));
  });
}
