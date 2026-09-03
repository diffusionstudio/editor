/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AdjustmentLayer, Geometry, Group, Scene, Source } from "@diffusionstudio/runtime";
import { parseSource } from "@diffusionstudio/jsx";
import { DapiError } from "@diffusionstudio/dapi";

import type { Entity, World } from "koota";

// Scenes are nodes too, so node-targeting tools accept them alongside
// geometry, groups, and adjustment layers.
export function isNode(entity: Entity): boolean {
  return entity.has(Geometry)
    || entity.has(Group)
    || entity.has(AdjustmentLayer)
    || entity.has(Scene);
}

/** The one node an id names, or the error that says why there is not exactly one. */
export function resolveNode(world: World, id: string): Entity {
  const matches = world.query(Source).filter((entity) => {
    const stamp = entity.get(Source)!.value;
    if (stamp === id) return true;
    const parsed = parseSource(stamp);
    return parsed !== undefined && String(parsed.locator) === id;
  });
  if (!matches.length) {
    throw new DapiError("not-found", `No such node: "${id}" — node ids are the id attributes in the project's JSX`);
  }

  const nodes = matches.filter(isNode);
  if (!nodes.length) {
    throw new DapiError("wrong-kind", `"${id}" is not a node; target a scene, group, clip, or adjustment layer`);
  }
  if (nodes.length > 1) {
    const stamps = [...new Set(nodes.map((node) => node.get(Source)!.value))];
    if (stamps.length === 1) {
      // One element, many entities: a loop renders its body once per item.
      throw new DapiError("ambiguous", `"${id}" renders ${nodes.length} times (it sits in a loop) — target its scene instead`);
    }
    throw new DapiError(
      "ambiguous",
      `"${id}" is ambiguous between ${stamps.map((stamp) => `"${stamp}"`).join(", ")} — use the file:id form`,
    );
  }
  return nodes[0]!;
}
