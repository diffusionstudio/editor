import { $internal } from '../common';
import type { Entity } from '../entity/types';
import { getEntityId } from '../entity/utils/pack-entity';
import { registerTrait } from '../trait/trait';
import { getTraitInstance, hasTraitInstance } from '../trait/trait-instance';
import type { Trait } from '../trait/types';
import type { World } from '../world';
import type { QueryParameter, QueryResult, SortCache, SortDirection, SortSource } from './types';

/** Values that have no meaningful position and are always pushed to the end. */
/* @inline @pure */ function isMissing(value: unknown): boolean {
  // `value !== value` catches NaN.
  return value === undefined || value === null || value !== value;
}

/* @inline @pure */ function compareValues(a: any, b: any): number {
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1;

  // Mixed types have no natural order, so group them by type name to stay deterministic.
  const typeA = typeof a;
  const typeB = typeof b;
  if (typeA !== typeB) return typeA < typeB ? -1 : 1;

  return a < b ? -1 : a > b ? 1 : 0;
}

/** Reads the sort value of every entity once so the comparator never touches the store. */
function readSortValues(
  world: World,
  entities: readonly Entity[],
  trait: Trait,
  key: string,
  values: unknown[]
) {
  const ctx = world[$internal];
  if (!hasTraitInstance(ctx.traitInstances, trait)) registerTrait(world, trait);

  const instance = getTraitInstance(ctx.traitInstances, trait)!;
  const store = instance.store as any;
  const isAoS = trait[$internal].type === 'aos';
  const column = isAoS ? undefined : store[key];

  // Stores keep stale values after a trait is removed and entity ids are recycled, so
  // presence has to come from the bitmask rather than from the value itself.
  const { generationId, bitflag } = instance;
  const masks = ctx.entityMasks[generationId];

  for (let i = 0; i < entities.length; i++) {
    const eid = getEntityId(entities[i]);
    if ((masks[eid] & bitflag) !== bitflag) {
      values[i] = undefined;
      continue;
    }
    values[i] = isAoS ? store[eid]?.[key] : column?.[eid];
  }
}

/**
 * Sorts `source` by `trait[key]` and writes the result into `target`.
 * `target` may be `source`. The sort is stable: entities that compare equal
 * keep their relative order from `source`.
 */
export function sortEntitiesInto(
  world: World,
  source: readonly Entity[],
  target: Entity[],
  trait: Trait,
  key: string,
  direction: SortDirection
) {
  const length = source.length;
  const values = new Array<unknown>(length);
  readSortValues(world, source, trait, key, values);

  const indices = new Array<number>(length);
  for (let i = 0; i < length; i++) indices[i] = i;

  const sign = direction === 'desc' ? -1 : 1;

  indices.sort((indexA, indexB) => {
    const a = values[indexA];
    const b = values[indexB];

    // Missing values sink to the bottom in both directions.
    const missingA = isMissing(a);
    const missingB = isMissing(b);
    if (missingA || missingB) {
      if (missingA && missingB) return indexA - indexB;
      return missingA ? 1 : -1;
    }

    const delta = compareValues(a, b);
    return delta !== 0 ? sign * delta : indexA - indexB;
  });

  // Reading from `target` while writing to it would corrupt the permutation.
  const from = target === source ? source.slice() : source;

  target.length = length;
  for (let i = 0; i < length; i++) target[i] = from[indices[i]];
}

/**
 * Returns a query result ordered by `trait[key]`, reusing a cached order when neither
 * the source entity set nor any sort value has changed since the last call.
 *
 * The cached order is stored per (source, trait, key, direction) on the world, so a
 * cache hit is a version comparison and returns the same result object as last time.
 */
export function getSortedResult<T extends QueryParameter[]>(
  world: World,
  source: SortSource,
  fallback: QueryResult<T>,
  entities: readonly Entity[],
  trait: Trait,
  key: string,
  direction: SortDirection
): QueryResult<T> {
  // Fewer than two entities are trivially ordered — skip the cache entirely.
  if (entities.length < 2) return fallback;

  const ctx = world[$internal];
  const cacheKey = `${source.key}|${trait.id}|${String(key)}|${direction}`;
  const version = source.version();

  let cache = ctx.sortCaches.get(cacheKey);

  // O(1) hit: the entity set and every sort value are untouched since the last sort.
  if (cache && !cache.dirty && cache.version === version) return cache.result as QueryResult<T>;

  if (!cache) {
    // Fill the order before wrapping it — result factories may special-case an empty array.
    const order: Entity[] = [];
    sortEntitiesInto(world, entities, order, trait, key, direction);

    const entry: SortCache = {
      order,
      result: source.createResult(order, cacheKey),
      version,
      dirty: false,
      members: new Set(),
    };

    // The entity set is versioned by the source, but writing a sort value leaves it
    // untouched, so mark the order stale whenever the trait moves on a member entity.
    const invalidate = (entity: Entity) => {
      if (entry.members.has(entity)) entry.dirty = true;
    };
    world.onChange(trait, invalidate);
    world.onAdd(trait, invalidate);
    world.onRemove(trait, invalidate);

    cache = entry;
    ctx.sortCaches.set(cacheKey, cache);
  } else {
    // Mutate the cached array in place so the cached result object stays valid.
    sortEntitiesInto(world, entities, cache.order, trait, key, direction);
  }

  cache.members.clear();
  for (let i = 0; i < cache.order.length; i++) cache.members.add(cache.order[i]);

  cache.version = version;
  cache.dirty = false;

  return cache.result as QueryResult<T>;
}
