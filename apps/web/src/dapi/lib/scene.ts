/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { getParentNode, isScene, Source } from "@diffusionstudio/runtime";
import { DapiError } from "@diffusionstudio/dapi";
import { resolveNode } from "./nodes";

import type { Entity, World } from "koota";

/**
 * The scene an id names. A scene is the unit an export renders, and capture's
 * promise is that its frames are an export's frames, so both take scenes only:
 * framing an arbitrary node would need its bounds measured across the
 * requested positions first, and that pre-roll runs the project's code ahead
 * of the frames being drawn, which is exactly what an export never does.
 *
 * `verb` names the caller in the error ("capture", "export").
 */
export function requireScene(world: World, id: string, verb: string): Entity {
  const node = resolveNode(world, id);
  if (isScene(node)) return node;

  let scene = getParentNode(node);
  while (scene !== null && !isScene(scene)) scene = getParentNode(scene);
  const stamp = scene?.get(Source)?.value;
  throw new DapiError(
    "wrong-kind",
    stamp
      ? `"${id}" is not a scene — ${verb} renders what an export renders. ${capitalize(verb)} its scene "${stamp}" instead.`
      : `"${id}" is not a scene — ${verb} renders what an export renders, so it takes a scene id.`,
  );
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
