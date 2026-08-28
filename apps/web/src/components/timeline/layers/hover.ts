/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Hovering } from '@diffusionstudio/runtime';

import type { Entity, World } from '@diffusionstudio/koota';

/**
 * Points the hover at one row, or at none. Only ever one row is hovered, so
 * this clears whatever held it rather than each row having to undo its own —
 * the pointer can leave a row without a leave event ever arriving (a row that
 * scrolls out from under it, or one that is removed).
 *
 * Hover is not authored: it says where the pointer is, which the file has
 * nothing to say about, so it is written straight to the trait.
 */
export function setRowHover(world: World, entity: Entity | null): void {
  for (const hovered of world.query(Hovering)) {
    if (hovered !== entity) hovered.remove(Hovering);
  }

  if (entity?.isAlive() && !entity.has(Hovering)) entity.add(Hovering);
}
