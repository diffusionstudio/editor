import type { Entity } from '../types';

// Constants for bit sizes
export const WORLD_ID_BITS = 4; // 4 bits can represent 0-15
export const GENERATION_BITS = 8; // 8 bits can represent 0-255
export const ENTITY_ID_BITS = 20; // 20 bits can represent 0-1,048,575
// Total bits used: 4 + 8 + 20 = 32 bits

// Masks for extracting values
export const WORLD_ID_MASK = (1 << WORLD_ID_BITS) - 1;
export const GENERATION_MASK = (1 << GENERATION_BITS) - 1;
export const ENTITY_ID_MASK = (1 << ENTITY_ID_BITS) - 1;

// Bit shifts for positioning each component
export const GENERATION_SHIFT = ENTITY_ID_BITS;
export const WORLD_ID_SHIFT = GENERATION_SHIFT + GENERATION_BITS;

export function packEntity(worldId: number, generation: number, entityId: number): Entity {
  return (((worldId & WORLD_ID_MASK) << WORLD_ID_SHIFT) |
    ((generation & GENERATION_MASK) << GENERATION_SHIFT) |
    (entityId & ENTITY_ID_MASK)) as Entity;
}

export function unpackEntity(entity: Entity) {
  return {
    worldId: entity >>> WORLD_ID_SHIFT,
    generation: (entity >>> GENERATION_SHIFT) & GENERATION_MASK,
    entityId: entity & ENTITY_ID_MASK,
  };
}

export const getEntityId = /* @inline @pure */ (entity: Entity) => entity & ENTITY_ID_MASK;
export const getEntityWorldId = /* @inline @pure */ (entity: Entity) => entity >>> WORLD_ID_SHIFT;
export const getEntityAndWorldId = /* @pure */ (entity: Entity): [number, number] => [
  entity & ENTITY_ID_MASK,
  entity >>> WORLD_ID_SHIFT,
];

export const getEntityGeneration = /* @inline @pure */ (entity: Entity) =>
  (entity >>> GENERATION_SHIFT) & GENERATION_MASK;

export const incrementGeneration = (entity: Entity): Entity =>
  ((entity & ~(GENERATION_MASK << GENERATION_SHIFT)) | // Clear current generation bits
    (((((entity >>> GENERATION_SHIFT) & GENERATION_MASK) + 1) & GENERATION_MASK) <<
      GENERATION_SHIFT)) as unknown as Entity; // Extract generation, increment, wrap around, shift back, and combine
