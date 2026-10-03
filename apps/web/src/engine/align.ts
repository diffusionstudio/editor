/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Align and distribute the selection: the nodes are moved in device space
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

type Sized = { box: Box };

type Item = { entity: Entity; box: Box };

const FALLBACK_GAP = 0.2;

const SIMILAR_SIZE = 1.5;

const SIMILAR_ASPECT = 1.15;

const PACK_ASPECT = 16 / 9;

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

function bands<T extends Sized>(items: T[], axis: Axis): T[][] {
  const min = (box: Box) => (axis === "x" ? box.minX : box.minY);
  const max = (box: Box) => (axis === "x" ? box.maxX : box.maxY);
  const result: { items: T[]; end: number }[] = [];

  for (const item of [...items].sort((a, b) => min(a.box) - min(b.box))) {
    const center = (min(item.box) + max(item.box)) / 2;
    const band = result[result.length - 1];
    if (band && center < band.end) band.items.push(item);
    else result.push({ items: [item], end: max(item.box) });
  }

  return result.map((band) => band.items);
}

function lowerMedian(values: number[]): number | undefined {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function typicalGap(values: number[]): number | undefined {
  return lowerMedian(values.filter((value) => value > 0));
}

function squareColumns(count: number): number {
  let columns = Math.ceil(Math.sqrt(count));
  while ((count % columns || columns) <= columns / 2) columns++;
  return columns;
}

const widthOf = (box: Box) => box.maxX - box.minX;
const heightOf = (box: Box) => box.maxY - box.minY;
const sizeRatio = (a: number, b: number) => Math.max(a, b) / Math.min(a, b);

type Arrangement<T> = { placed: { item: T; x: number; y: number }[]; width: number; height: number; gap: number };

function fallbackGap(items: Sized[], scale: number): number {
  const side = items.reduce((sum, { box }) => sum + Math.min(widthOf(box), heightOf(box)), 0) / items.length;
  return Math.round((side * FALLBACK_GAP) / scale) * scale;
}

function arrange<T extends Sized>(items: T[], scale: number, fixedGap?: number): Arrangement<T> {
  const rows = bands(items, "y").map((row) => row.sort((a, b) => a.box.minX - b.box.minX));
  const columnBands = bands(items, "x");
  const count = items.length;
  const longest = (groups: T[][]) => Math.max(...groups.map((group) => group.length));

  const structured = rows.length === 1 || rows.length * columnBands.length <= 2 * count;
  const columns =
    rows.length === 1 ? count
    : structured ? Math.max(longest(rows), Math.ceil(count / longest(columnBands)))
    : squareColumns(count);

  const planar = rows.length > 1 && columnBands.length > 1;
  const width = lowerMedian(items.map(({ box }) => widthOf(box)))!;
  const height = lowerMedian(items.map(({ box }) => heightOf(box)))!;
  const spacing = (gap: number | undefined, size: number) =>
    !structured || gap === undefined || (planar && gap >= size) ? undefined : Math.round(gap / scale) * scale;

  const gapX = spacing(typicalGap(rows.flatMap((row) => row.slice(1).map((item, index) => item.box.minX - row[index]!.box.maxX))), width);
  const gapY = spacing(typicalGap(rows.slice(1).map((row, index) =>
    Math.min(...row.map((item) => item.box.minY)) - Math.max(...rows[index]!.map((item) => item.box.maxY)))), height);
  const measured = [gapX, gapY].filter((gap) => gap !== undefined);
  const gap = fixedGap ?? (measured.length ? Math.min(...measured) : fallbackGap(items, scale));

  const order = rows.flat();
  const widths = new Array<number>(columns).fill(0);
  order.forEach(({ box }, index) => {
    widths[index % columns] = Math.max(widths[index % columns]!, widthOf(box));
  });

  const placed: Arrangement<T>["placed"] = [];
  let top = 0;
  for (let start = 0; start < count; start += columns) {
    const line = order.slice(start, start + columns);
    let left = 0;
    line.forEach((item, column) => {
      placed.push({ item, x: left, y: top });
      left += widths[column]! + gap;
    });
    top += Math.max(...line.map(({ box }) => heightOf(box))) + gap;
  }

  return { placed, width: widths.reduce((sum, size) => sum + size, 0) + gap * (columns - 1), height: top - gap, gap };
}

type Column<T> = { items: T[]; width: number; height: number };
type Shelf<T> = { height: number; columns: Column<T>[] };

const shelfWidth = (shelf: Shelf<unknown>, gap: number) =>
  shelf.columns.reduce((sum, column) => sum + column.width, 0) + gap * (shelf.columns.length - 1);

function shelve<T extends Sized>(sorted: T[], gap: number, limit: number): Shelf<T>[] {
  const shelves: Shelf<T>[] = [];

  for (const item of sorted) {
    const width = widthOf(item.box);
    const height = heightOf(item.box);

    let fit: { column: Column<T>; room: number } | undefined;
    for (const shelf of shelves) {
      for (const column of shelf.columns) {
        const room = shelf.height - column.height - gap - height;
        const widened = shelfWidth(shelf, gap) - column.width + Math.max(column.width, width);
        if (room >= 0 && widened <= limit && (!fit || room < fit.room)) fit = { column, room };
      }
    }

    if (fit) {
      fit.column.items.push(item);
      fit.column.height += gap + height;
      fit.column.width = Math.max(fit.column.width, width);
      continue;
    }

    const shelf = shelves.find((candidate) => shelfWidth(candidate, gap) + gap + width <= limit);
    if (shelf) shelf.columns.push({ items: [item], width, height });
    else shelves.push({ height, columns: [{ items: [item], width, height }] });
  }

  return shelves;
}

function pack<T extends Sized>(blocks: T[], gap: number): Arrangement<T> {
  const sorted = [...blocks].sort((a, b) =>
    heightOf(b.box) - heightOf(a.box) || widthOf(b.box) - widthOf(a.box) || a.box.minY - b.box.minY || a.box.minX - b.box.minX);

  const limits = [Math.max(...sorted.map(({ box }) => widthOf(box)))];
  sorted.reduce((sum, { box }) => {
    limits.push(sum + widthOf(box));
    return sum + widthOf(box) + gap;
  }, 0);

  let best: { shelves: Shelf<T>[]; width: number; height: number; zoom: number } | undefined;
  for (const limit of limits) {
    const shelves = shelve(sorted, gap, limit);
    const width = Math.max(...shelves.map((shelf) => shelfWidth(shelf, gap)));
    const height = shelves.reduce((sum, shelf) => sum + shelf.height, 0) + gap * (shelves.length - 1);
    const zoom = Math.max(width, height * PACK_ASPECT);
    if (!best || zoom < best.zoom) best = { shelves, width, height, zoom };
  }

  const placed: Arrangement<T>["placed"] = [];
  let top = 0;
  for (const shelf of best!.shelves) {
    let left = 0;
    for (const column of shelf.columns) {
      let y = top;
      for (const item of column.items) {
        placed.push({ item, x: left, y });
        y += heightOf(item.box) + gap;
      }
      left += column.width + gap;
    }
    top += shelf.height + gap;
  }

  return { placed, width: best!.width, height: best!.height, gap };
}

function alike(a: Item, b: Item): boolean {
  return isScene(a.entity) === isScene(b.entity)
    && sizeRatio(widthOf(a.box), widthOf(b.box)) <= SIMILAR_SIZE
    && sizeRatio(heightOf(a.box), heightOf(b.box)) <= SIMILAR_SIZE
    && sizeRatio(widthOf(a.box) / heightOf(a.box), widthOf(b.box) / heightOf(b.box)) <= SIMILAR_ASPECT;
}

function groupsOf(items: Item[]): Item[][] {
  const groups: Item[][] = [];
  const seen = new Set<Item>();

  for (const start of items) {
    if (seen.has(start)) continue;
    seen.add(start);
    const group = [start];
    for (let index = 0; index < group.length; index++) {
      for (const other of items) {
        if (seen.has(other) || !alike(group[index]!, other)) continue;
        seen.add(other);
        group.push(other);
      }
    }
    groups.push(group);
  }

  return groups;
}

export function tidySelection(world: World): void {
  const entities = getAlignableSelection(world);
  if (entities.length < 2) return;

  const items = entities.map((entity) => ({ entity, box: boundsOf(world, entity) }));
  const scale = getCameraScale(world) * (world.get(RenderSurface)?.resolution ?? 1);

  const linear = bands(items, "y").length === 1 || bands(items, "x").length === 1;
  const groups = linear ? [items] : groupsOf(items);

  let placed: Arrangement<Item>["placed"];
  if (groups.length === 1) {
    placed = arrange(items, scale).placed;
  } else {
    const gap = fallbackGap(items, scale);
    const blocks = groups.map((group) => {
      const inner = arrange(group, scale, gap);
      const at = union(group.map(({ box }) => box));
      return { inner, box: { minX: at.minX, minY: at.minY, maxX: at.minX + inner.width, maxY: at.minY + inner.height } };
    });
    placed = pack(blocks, gap).placed.flatMap(({ item: block, x, y }) =>
      block.inner.placed.map((spot) => ({ item: spot.item, x: x + spot.x, y: y + spot.y })));
  }

  const origin = union(items.map(({ box }) => box));
  const settle = (delta: number) => (Math.abs(delta) < scale / 2 ? 0 : delta);

  for (const { item, x, y } of placed) {
    moveByWorldDelta(world, item.entity, settle(origin.minX + x - item.box.minX), settle(origin.minY + y - item.box.minY));
  }
}
