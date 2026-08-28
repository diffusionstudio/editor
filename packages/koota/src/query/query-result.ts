import { $internal } from '../common';
import type { Entity } from '../entity/types';
import { getEntityId } from '../entity/utils/pack-entity';
import { isRelationPair } from '../relation/utils/is-relation';
import type { Relation } from '../relation/types';
import type { Store } from '../storage';
import { getStore } from '../trait/trait';
import type { Trait } from '../trait/types';
import { shallowEqual } from '../utils/shallow-equal';
import type { World } from '../world';
import { isModifier } from './modifier';
import { setChanged } from './modifiers/changed';
import { getRelationSourceVersion } from '../relation/relation';
import { getSortedResult, sortEntitiesInto } from './sort';
import { $sortSource } from './symbols';
import type {
  InstancesFromParameters,
  QueryInstance,
  QueryParameter,
  QueryResult,
  QueryResultOptions,
  RelationSortContext,
  SortableKeys,
  SortDirection,
  StoresFromParameters,
} from './types';
import { createQueryHash } from './utils/create-query-hash';

export function createQueryResult<T extends QueryParameter[]>(
  world: World,
  entities: Entity[],
  query: QueryInstance,
  params: QueryParameter[],
  sortKey?: string
): QueryResult<T> {
  const traits: Trait[] = [];
  const stores: Store<any>[] = [];

  getQueryStores(params, traits, stores, world);

  // `select` swaps the projected params, which changes the shape of a cached sorted result.
  let currentParams = params;
  const sortBaseKey = sortKey ?? `q${query.hash}`;
  let sortSourceKey = sortBaseKey;

  const results = Object.assign(entities, {
    readEach(callback: (state: InstancesFromParameters<T>, entity: Entity, index: number) => void) {
      const state = Array.from({ length: traits.length }) as InstancesFromParameters<T>;

      for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        const eid = getEntityId(entity);

        // Create snapshots without atomic tracking
        createSnapshots(eid, traits, stores, state);

        callback(state, entity, i);
      }

      return results;
    },

    updateEach(
      callback: (state: InstancesFromParameters<T>, entity: Entity, index: number) => void,
      options: QueryResultOptions = { changeDetection: 'auto' }
    ) {
      const state = Array.from({ length: traits.length });

      // Inline all three permutations of updateEach for performance.
      if (options.changeDetection === 'auto') {
        const changedPairs: [Entity, Trait][] = [];
        const atomicSnapshots: any[] = [];
        const trackedIndices: number[] = [];
        const untrackedIndices: number[] = [];

        getTrackedTraits(traits, world, query, trackedIndices, untrackedIndices);

        for (let i = 0; i < entities.length; i++) {
          const entity = entities[i];
          const eid = getEntityId(entity);

          createSnapshotsWithAtomic(eid, traits, stores, state, atomicSnapshots);
          callback(state as unknown as InstancesFromParameters<T>, entity, i);

          // Skip if the entity has been destroyed.
          if (!world.has(entity)) continue;

          // Commit all changes back to the stores for tracked traits.
          for (let j = 0; j < trackedIndices.length; j++) {
            const index = trackedIndices[j];
            const trait = traits[index];
            const ctx = trait[$internal];
            const newValue = state[index];
            const store = stores[index];

            let changed = false;
            if (ctx.type === 'aos') {
              changed = ctx.fastSetWithChangeDetection(eid, store, newValue);
              if (!changed) {
                changed = !shallowEqual(newValue, atomicSnapshots[index]);
              }
            } else {
              changed = ctx.fastSetWithChangeDetection(eid, store, newValue);
            }

            // Collect changed traits.
            if (changed) changedPairs.push([entity, trait] as const);
          }

          // Commit all changes back to the stores for untracked traits.
          for (let j = 0; j < untrackedIndices.length; j++) {
            const index = untrackedIndices[j];
            const trait = traits[index];
            const ctx = trait[$internal];
            const store = stores[index];
            ctx.fastSet(eid, store, state[index]);
          }
        }

        // Trigger change events for each entity that was modified.
        for (let i = 0; i < changedPairs.length; i++) {
          const [entity, trait] = changedPairs[i];
          setChanged(world, entity, trait);
        }
      } else if (options.changeDetection === 'always') {
        const changedPairs: [Entity, Trait][] = [];
        const atomicSnapshots: any[] = [];

        for (let i = 0; i < entities.length; i++) {
          const entity = entities[i];
          const eid = getEntityId(entity);

          createSnapshotsWithAtomic(eid, traits, stores, state, atomicSnapshots);
          callback(state as unknown as InstancesFromParameters<T>, entity, i);

          // Skip if the entity has been destroyed.
          if (!world.has(entity)) continue;

          // Commit all changes back to the stores.
          for (let j = 0; j < traits.length; j++) {
            const trait = traits[j];
            const ctx = trait[$internal];
            const newValue = state[j];

            let changed = false;
            if (ctx.type === 'aos') {
              changed = ctx.fastSetWithChangeDetection(eid, stores[j], newValue);
              if (!changed) {
                changed = !shallowEqual(newValue, atomicSnapshots[j]);
              }
            } else {
              changed = ctx.fastSetWithChangeDetection(eid, stores[j], newValue);
            }

            // Collect changed traits.
            if (changed) changedPairs.push([entity, trait] as const);
          }
        }

        // Trigger change events for each entity that was modified.
        for (let i = 0; i < changedPairs.length; i++) {
          const [entity, trait] = changedPairs[i];
          setChanged(world, entity, trait);
        }
      } else if (options.changeDetection === 'never') {
        for (let i = 0; i < entities.length; i++) {
          const entity = entities[i];
          const eid = getEntityId(entity);
          createSnapshots(eid, traits, stores, state);
          callback(state as unknown as InstancesFromParameters<T>, entity, i);

          // Skip if the entity has been destroyed.
          if (!world.has(entity)) continue;

          // Commit all changes back to the stores.
          for (let j = 0; j < traits.length; j++) {
            const trait = traits[j];
            const ctx = trait[$internal];
            ctx.fastSet(eid, stores[j], state[j]);
          }
        }
      }

      return results;
    },

    useStores(callback: (stores: StoresFromParameters<T>, entities: readonly Entity[]) => void) {
      callback(stores as unknown as StoresFromParameters<T>, entities);
      return results;
    },

    select<U extends QueryParameter[]>(...params: U): QueryResult<U> {
      traits.length = 0;
      stores.length = 0;
      getQueryStores(params, traits, stores, world);
      currentParams = params;
      sortSourceKey = `${sortBaseKey}#${createQueryHash(params)}`;
      return results as unknown as QueryResult<U>;
    },

    sort(
      callback: (a: Entity, b: Entity) => number = (a, b) => getEntityId(a) - getEntityId(b)
    ): QueryResult<T> {
      Array.prototype.sort.call(entities, callback);
      return results;
    },

    sortBy<S extends Trait>(
      trait: S,
      key: SortableKeys<S>,
      direction: SortDirection = 'asc'
    ): QueryResult<T> {
      // Tracking queries rebuild their result on every run, so there is no stable
      // entity set to cache an order against. Sort in place instead.
      if (query.isTracking) {
        sortEntitiesInto(world, entities, entities, trait, key as string, direction);
        return results;
      }

      return getSortedResult(
        world,
        {
          key: sortSourceKey,
          version: () => query.version,
          createResult: (order, cacheKey) =>
            createQueryResult(world, order, query, currentParams, cacheKey),
        },
        results,
        entities,
        trait,
        key as string,
        direction
      );
    },
  });

  return results;
}

/* @inline */ function getTrackedTraits(
  traits: Trait[],
  world: World,
  query: QueryInstance,
  trackedIndices: number[],
  untrackedIndices: number[]
) {
  for (let i = 0; i < traits.length; i++) {
    const trait = traits[i];
    const hasTracked = world[$internal].trackedTraits.has(trait);
    const hasChanged = query.hasChangedModifiers && query.changedTraits.has(trait);

    if (hasTracked || hasChanged) trackedIndices.push(i);
    else untrackedIndices.push(i);
  }
}

/* @inline */ function createSnapshots(
  entityId: number,
  traits: Trait[],
  stores: Store<any>[],
  state: any[]
) {
  for (let i = 0; i < traits.length; i++) {
    const trait = traits[i];
    const ctx = trait[$internal];
    const value = ctx.get(entityId, stores[i]);
    state[i] = value;
  }
}

/* @inline */ function createSnapshotsWithAtomic(
  entityId: number,
  traits: Trait[],
  stores: Store<any>[],
  state: any[],
  atomicSnapshots: any[]
) {
  for (let j = 0; j < traits.length; j++) {
    const trait = traits[j];
    const ctx = trait[$internal];
    const value = ctx.get(entityId, stores[j]);
    state[j] = value;
    atomicSnapshots[j] = ctx.type === 'aos' ? { ...value } : null;
  }
}

/* @inline */ export function getQueryStores<T extends QueryParameter[]>(
  params: T,
  traits: Trait[],
  stores: Store<any>[],
  world: World
) {
  for (let i = 0; i < params.length; i++) {
    const param = params[i];

    // Handle relation pairs
    if (isRelationPair(param)) {
      const relation = param.relation as Relation<Trait>;
      const baseTrait = relation[$internal].trait;
      if (baseTrait[$internal].type !== 'tag') {
        traits.push(baseTrait);
        stores.push(getStore(world, baseTrait));
      }
      continue;
    }

    if (isModifier(param)) {
      // Skip not modifier.
      if (param.type === 'not') continue;

      const modifierTraits = param.traits;
      for (const trait of modifierTraits) {
        if (trait[$internal].type === 'tag') continue; // Skip tags
        traits.push(trait);
        stores.push(getStore(world, trait));
      }
    } else {
      const trait = param as Trait;
      if (trait[$internal].type === 'tag') continue; // Skip tags
      traits.push(trait);
      stores.push(getStore(world, trait));
    }
  }
}

export function createEmptyQueryResult(): QueryResult<QueryParameter[]> {
  const results = Object.assign([], {
    readEach: () => results,
    updateEach: () => results,
    useStores: () => results,
    select: () => results,
    sort: () => results,
    sortBy: () => results,
  }) as QueryResult<QueryParameter[]>;

  return results;
}

// Shared methods for relation-only query snapshots.
const relationOnlyMethods = {
  readEach(this: QueryResult<any>, callback: any) {
    for (let i = 0; i < this.length; i++) {
      callback([], this[i], i);
    }
    return this;
  },
  updateEach(this: QueryResult<any>, callback: any) {
    for (let i = 0; i < this.length; i++) {
      callback([], this[i], i);
    }
    return this;
  },
  useStores(this: QueryResult<any>, callback: any) {
    callback([], this);
    return this;
  },
  select(this: QueryResult<any>) {
    return this;
  },
  sort(
    this: QueryResult<any>,
    callback: (a: Entity, b: Entity) => number = (a, b) => getEntityId(a) - getEntityId(b)
  ) {
    Array.prototype.sort.call(this, callback);
    return this;
  },
  sortBy(
    this: QueryResult<any>,
    trait: Trait,
    key: string,
    direction: SortDirection = 'asc'
  ): QueryResult<any> {
    const source = this[$sortSource];
    if (!source) return this;

    const { world, relationTrait, target } = source;
    const relation = relationTrait[$internal].relation as Relation<Trait>;

    return getSortedResult(
      world,
      {
        key: source.sortKey ?? `r${relationTrait.id}:${getEntityId(target)}`,
        version: () => getRelationSourceVersion(world, relation, target),
        createResult: (order, cacheKey) =>
          createRelationOnlyQueryResult(order, { ...source, sortKey: cacheKey }),
      },
      this,
      this,
      trait,
      key,
      direction
    );
  },
};

/**
 * Lightweight query result for relation-only queries.
 * Skips store/trait setup since we only need to iterate entities.
 *
 * `sortSource` identifies the source set and is only needed to support `sortBy`; without
 * it `sortBy` returns the result unchanged.
 */
export function createRelationOnlyQueryResult<T extends QueryParameter[]>(
  entities: Entity[],
  sortSource?: RelationSortContext
): QueryResult<T> {
  if (entities.length === 0) return cachedEmptyRelationResult as unknown as QueryResult<T>;

  const result = Object.assign(entities, relationOnlyMethods) as unknown as QueryResult<T>;
  if (sortSource !== undefined) (result as any)[$sortSource] = sortSource;

  return result;
}

const cachedEmptyRelationResult = Object.assign([], relationOnlyMethods) as QueryResult<any>;
