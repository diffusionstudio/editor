import { WORLD_ID_BITS } from '../../entity/utils/pack-entity';

export type WorldIndex = {
  worldCursor: number;
  releasedWorldIds: number[];
  maxWorlds: number;
};

/**
 * Creates and initializes a new WorldIndex.
 * @param worldIdBits - The number of bits used for world IDs.
 * @returns A new WorldIndex object.
 */
export function createWorldIndex(): WorldIndex {
  return {
    worldCursor: 0,
    releasedWorldIds: [],
    maxWorlds: 2 ** WORLD_ID_BITS,
  };
}

/**
 * Allocates a new world ID or recycles an existing one.
 * @param index - The WorldIndex to allocate from.
 * @returns The new or recycled world ID.
 */
export function allocateWorldId(index: WorldIndex): number {
  if (index.releasedWorldIds.length > 0) {
    return index.releasedWorldIds.pop()!;
  }

  if (index.worldCursor >= index.maxWorlds) {
    throw new Error(`Koota: Too many worlds created. The maximum is ${index.maxWorlds}.`);
  }
  return index.worldCursor++;
}

/**
 * Releases a world ID back to the index.
 * @param index - The WorldIndex to release to.
 * @param worldId - The world ID to release.
 */
export function releaseWorldId(index: WorldIndex, worldId: number): void {
  if (worldId < 0 || worldId >= index.maxWorlds) {
    throw new Error(`Invalid world ID: ${worldId}`);
  }

  if (worldId === index.worldCursor - 1) {
    // If it's the last allocated ID, just decrement the cursor
    index.worldCursor--;
  } else if (worldId < index.worldCursor && !index.releasedWorldIds.includes(worldId)) {
    // Otherwise, add it to the released IDs list for recycling
    index.releasedWorldIds.push(worldId);
  }
}
