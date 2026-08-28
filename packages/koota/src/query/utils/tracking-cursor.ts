import { $internal } from '../../common';
import type { World } from '../../world';

// Some values are reserved.
// 0 - has
// 1 - not
// 2 - or
let cursor = 3;

export function createTrackingId() {
  return cursor++;
}

export function getTrackingCursor() {
  return cursor;
}

export function setTrackingMasks(world: World, id: number) {
  const ctx = world[$internal];
  const snapshot = structuredClone(ctx.entityMasks);
  ctx.trackingSnapshots.set(id, snapshot);

  // For dirty and changed masks, make clone of entity masks and set all bits to 0.
  ctx.dirtyMasks.set(
    id,
    snapshot.map((mask) => mask.map(() => 0))
  );

  ctx.changedMasks.set(
    id,
    snapshot.map((mask) => mask.map(() => 0))
  );
}
