/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ChildOf, ColorStop, Computed, colorToHex } from "@diffusionstudio/runtime";

import type { Entity, World } from "@diffusionstudio/koota";

export type GradientStop = {
  entity: Entity;
  /** Position along the gradient; the animated value, so 0-1 is only the usual case. */
  offset: number;
  color: number;
  opacity: number;
};

/**
 * The `<colorStop>` children of a gradient paint, in the order they paint in
 * (by offset, not by document order: where a stop sits is its `offset`, and
 * the file's order says nothing). Values come off `Computed`, which the
 * motion system writes, so callers sample this through `useDerived`.
 */
export function readGradientStops(world: World, fill: Entity): GradientStop[] {
  return [...world.query(ColorStop, ChildOf(fill))]
    .map((entity) => {
      const computed = entity.get(Computed);
      return {
        entity,
        offset: computed?.stopOffset ?? 0,
        color: computed?.color ?? 0xFFFFFF,
        opacity: computed?.opacity ?? 1,
      };
    })
    .sort((a, b) => a.offset - b.offset);
}

/** Compares two samples by value, so a resample per tick does not notify. */
export function sameGradientStops(a: GradientStop[], b: GradientStop[]): boolean {
  return a.length === b.length && a.every((stop, index) => {
    const other = b[index]!;
    return stop.entity === other.entity
      && stop.offset === other.offset
      && stop.color === other.color
      && stop.opacity === other.opacity;
  });
}

/**
 * The stops as `<colorStop>` props, for spelling them onto another gradient
 * element (the two gradient kinds are two tags, so switching between them
 * writes the stops out again). Opacity is left off at its default.
 */
export function readStopProps(world: World, fill: Entity): { offset: number; color: string; opacity?: number }[] {
  return readGradientStops(world, fill).map((stop) => ({
    offset: stop.offset,
    color: colorToHex(stop.color),
    ...(stop.opacity === 1 ? {} : { opacity: stop.opacity }),
  }));
}
