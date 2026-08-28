import { $internal } from '../common';
import { createEntity, destroyEntity } from '../entity/entity';
import type { Entity } from '../entity/types';
import { createEntityIndex, getAliveEntities, isEntityAlive } from '../entity/utils/entity-index';
import { IsExcluded, createQuery, createQueryInstance } from '../query/query';
import { createRelationOnlyQueryResult } from '../query/query-result';
import type { Query, QueryInstance, QueryParameter, QueryUnsubscriber } from '../query/types';
import { createQueryHash } from '../query/utils/create-query-hash';
import { isQuery } from '../query/utils/is-query';
import { getTrackingCursor, setTrackingMasks } from '../query/utils/tracking-cursor';
import { getEntitiesWithRelationTo } from '../relation/relation';
import type { Relation, RelationPair } from '../relation/types';
import { isRelation, isRelationPair } from '../relation/utils/is-relation';
import { addTrait, getTrait, hasTrait, registerTrait, removeTrait, setTrait } from '../trait/trait';
import { clearTraitInstance, getTraitInstance, hasTraitInstance } from '../trait/trait-instance';
import type {
  ConfigurableTrait,
  ExtractSchema,
  SetTraitCallback,
  Trait,
  TraitRecord,
  TraitValue,
} from '../trait/types';
import { universe } from '../universe/universe';
import type { World, WorldInternal, WorldOptions } from './types';
import { allocateWorldId, releaseWorldId } from './utils/world-index';

export function createWorld(options: WorldOptions): World;
export function createWorld(...traits: ConfigurableTrait[]): World;
export function createWorld(
  optionsOrFirstTrait?: WorldOptions | ConfigurableTrait,
  ...traits: ConfigurableTrait[]
): World {
  const id = allocateWorldId(universe.worldIndex);
  let isInitialized = false;
  let lazyTraits: ConfigurableTrait[] | undefined;
  type HookInput = Trait | Relation<Trait> | RelationPair<Trait>;
  type HookCallback = (entity: Entity, target?: Entity) => void;

  function resolveHookTrait(input: HookInput): Trait {
    if (isRelationPair(input)) return input.relation[$internal].trait;
    if (isRelation(input)) return input[$internal].trait;
    return input;
  }

  function resolveHookCallback(input: HookInput, callback: HookCallback): HookCallback {
    if (isRelationPair(input)) {
      const pairTargetQuery = input.targetQuery;
      if (pairTargetQuery) {
        const targetQuery = isQuery(pairTargetQuery)
          ? pairTargetQuery
          : createQuery(...pairTargetQuery);

        return (entity: Entity, target?: Entity) => {
          /**
           * @todo This should be using the same caching logic as the query system
           * instead of searching with `includes`.
           */
          if (target !== undefined && world.query(targetQuery).includes(target)) {
            callback(entity, target);
          }
        };
      }

      const pairTarget = input.target;
      if (pairTarget === '*') return callback;

      return (entity: Entity, target?: Entity) => {
        if (target === pairTarget) callback(entity, target);
      };
    }

    return callback;
  }

  const world = {
    [$internal]: {
      entityIndex: createEntityIndex(id),
      entityMasks: [[]],
      entityTraits: new Map(),
      bitflag: 1,
      traitInstances: [],
      relations: new Set(),
      queriesHashMap: new Map(),
      queryInstances: [],
      actionInstances: [],
      notQueries: new Set(),
      dirtyQueries: new Set(),
      dirtyMasks: new Map(),
      trackingSnapshots: new Map(),
      changedMasks: new Map(),
      worldEntity: null!,
      trackedTraits: new Set(),
      resetSubscriptions: new Set(),
      sortCaches: new Map(),
    } as WorldInternal,

    traits: new Set<Trait>(),

    init(...initTraits: ConfigurableTrait[]) {
      const ctx = world[$internal];
      if (isInitialized) return;

      isInitialized = true;
      universe.worlds[id] = world;

      // Create uninitialized added masks.
      const cursor = getTrackingCursor();
      for (let i = 0; i < cursor; i++) {
        setTrackingMasks(world, i);
      }

      // Register system traits.
      if (!hasTraitInstance(ctx.traitInstances, IsExcluded)) registerTrait(world, IsExcluded);

      // Check for traits passed into lazy init
      if (lazyTraits) {
        initTraits = lazyTraits;
        // clear lazyTraits
        lazyTraits = undefined;
      }
      // Create world entity.
      ctx.worldEntity = createEntity(world, IsExcluded, ...initTraits);
    },

    spawn(...spawnTraits: ConfigurableTrait[]): Entity {
      return createEntity(world, ...spawnTraits);
    },

    has(target: Entity | Trait): boolean {
      return typeof target === 'number'
        ? isEntityAlive(world[$internal].entityIndex, target)
        : hasTrait(world, world[$internal].worldEntity, target);
    },

    add(...addTraits: ConfigurableTrait[]) {
      addTrait(world, world[$internal].worldEntity, ...addTraits);
    },

    remove(...removeTraits: Trait[]) {
      removeTrait(world, world[$internal].worldEntity, ...removeTraits);
    },

    get<T extends Trait>(trait: T): TraitRecord<ExtractSchema<T>> | undefined {
      return getTrait(world, world[$internal].worldEntity, trait);
    },

    set<T extends Trait>(trait: T, value: TraitValue<ExtractSchema<T>> | SetTraitCallback<T>) {
      setTrait(world, world[$internal].worldEntity, trait, value, true);
    },

    destroy() {
      // Destroy world entity.
      destroyEntity(world, world[$internal].worldEntity);
      world[$internal].worldEntity = null!;

      world.reset();
      isInitialized = false;
      // Clean up universe side effects.
      releaseWorldId(universe.worldIndex, id);
      universe.worlds[id] = null;
    },

    reset() {
      lazyTraits = undefined;
      const ctx = world[$internal];

      // Destroy all entities so any cleanup is done.
      world.entities.forEach((entity) => {
        // Some relations may have caused the entity to be destroyed before
        // we get to them in the loop.
        if (world.has(entity)) {
          destroyEntity(world, entity);
        }
      });

      ctx.entityIndex = createEntityIndex(id);
      ctx.entityTraits.clear();
      ctx.entityMasks = [[]];
      ctx.bitflag = 1;

      for (const query of ctx.queriesHashMap.values()) {
        for (let i = 0; i < query.cleanup.length; i++) {
          query.cleanup[i]();
        }
      }

      clearTraitInstance(ctx.traitInstances);
      world.traits.clear();
      ctx.relations.clear();

      ctx.queriesHashMap.clear();
      ctx.queryInstances.length = 0;
      ctx.actionInstances.length = 0;
      ctx.dirtyQueries.clear();
      ctx.notQueries.clear();

      ctx.trackingSnapshots.clear();
      ctx.dirtyMasks.clear();
      ctx.changedMasks.clear();
      ctx.trackedTraits.clear();
      ctx.sortCaches.clear();

      // Create new world entity.
      ctx.worldEntity = createEntity(world, IsExcluded);

      for (const sub of ctx.resetSubscriptions) {
        sub(world);
      }
    },

    query(...args: any[]) {
      const ctx = world[$internal];

      // Check if first arg is a QueryRef
      if (args.length === 1 && isQuery(args[0])) {
        const queryRef = args[0];
        // Try array lookup first
        let query = ctx.queryInstances[queryRef.id];
        if (query) return query.run(world, queryRef.parameters);

        // Fallback to hash map
        query = ctx.queriesHashMap.get(queryRef.hash);
        if (!query) {
          query = createQueryInstance(world, queryRef.parameters);
          ctx.queriesHashMap.set(queryRef.hash, query);
          // Store in array for fast future lookups
          if (queryRef.id >= ctx.queryInstances.length) {
            ctx.queryInstances.length = queryRef.id + 1;
          }
          ctx.queryInstances[queryRef.id] = query;
        }
        return query.run(world, queryRef.parameters);
      } else {
        const params = args as QueryParameter[];

        // Fast path: single relation pair with specific target
        if (params.length === 1 && isRelationPair(params[0])) {
          const relation = params[0].relation;
          const target = params[0].target;

          // Only use fast path for specific targets
          if (!params[0].targetQuery && typeof target === 'number') {
            const entities = getEntitiesWithRelationTo(
              world,
              relation as Relation<Trait>,
              target as Entity
            );
            return createRelationOnlyQueryResult(entities as Entity[], {
              world,
              relationTrait: (relation as Relation<Trait>)[$internal].trait,
              target: target as Entity,
            });
          }
        }

        const hash = createQueryHash(params);
        let query = ctx.queriesHashMap.get(hash);

        if (!query) {
          query = createQueryInstance(world, params);
          ctx.queriesHashMap.set(hash, query);
        }

        return query.run(world, params);
      }
    },

    queryFirst(...args: [string] | QueryParameter[]) {
      // @ts-expect-error - Having an issue with the TS overloads.
      return world.query(...args)[0];
    },

    onQueryAdd(
      args: Query<QueryParameter[]> | QueryParameter[],
      callback: (entity: Entity) => void
    ): QueryUnsubscriber {
      const ctx = world[$internal];
      let query: QueryInstance;

      // Check if args is a QueryRef object
      if (isQuery(args)) {
        const queryRef = args;
        query = ctx.queryInstances[queryRef.id] || ctx.queriesHashMap.get(queryRef.hash)!;

        if (!query) {
          query = createQueryInstance(world, queryRef.parameters);
          ctx.queriesHashMap.set(queryRef.hash, query);
          if (queryRef.id >= ctx.queryInstances.length) {
            ctx.queryInstances.length = queryRef.id + 1;
          }
          ctx.queryInstances[queryRef.id] = query;
        }
      } else {
        const hash = createQueryHash(args as QueryParameter[]);
        query = ctx.queriesHashMap.get(hash)!;

        if (!query) {
          query = createQueryInstance(world, args as QueryParameter[]);
          ctx.queriesHashMap.set(hash, query);
        }
      }

      query.addSubscriptions.add(callback);

      return () => query.addSubscriptions.delete(callback);
    },

    onQueryRemove(
      args: Query<QueryParameter[]> | QueryParameter[],
      callback: (entity: Entity) => void
    ): QueryUnsubscriber {
      const ctx = world[$internal];
      let query: QueryInstance;

      // Check if args is a QueryRef object
      if (isQuery(args)) {
        const queryRef = args;
        query = ctx.queryInstances[queryRef.id] || ctx.queriesHashMap.get(queryRef.hash)!;

        if (!query) {
          query = createQueryInstance(world, queryRef.parameters);
          ctx.queriesHashMap.set(queryRef.hash, query);
          if (queryRef.id >= ctx.queryInstances.length) {
            ctx.queryInstances.length = queryRef.id + 1;
          }
          ctx.queryInstances[queryRef.id] = query;
        }
      } else {
        const hash = createQueryHash(args as QueryParameter[]);
        query = ctx.queriesHashMap.get(hash)!;

        if (!query) {
          query = createQueryInstance(world, args as QueryParameter[]);
          ctx.queriesHashMap.set(hash, query);
        }
      }

      query.removeSubscriptions.add(callback);

      return () => query.removeSubscriptions.delete(callback);
    },

    onAdd<T extends Trait>(
      trait: T | Relation<T> | RelationPair<T>,
      callback: (entity: Entity, target?: Entity) => void
    ): QueryUnsubscriber {
      const ctx = world[$internal];
      const resolvedTrait = resolveHookTrait(trait);
      const resolvedCallback = resolveHookCallback(trait, callback);

      let data = getTraitInstance(ctx.traitInstances, resolvedTrait);

      if (!data) {
        registerTrait(world, resolvedTrait);
        data = getTraitInstance(ctx.traitInstances, resolvedTrait)!;
      }

      data.addSubscriptions.add(resolvedCallback);

      return () => data.addSubscriptions.delete(resolvedCallback);
    },

    onRemove<T extends Trait>(
      trait: T | Relation<T> | RelationPair<T>,
      callback: (entity: Entity, target?: Entity) => void
    ): QueryUnsubscriber {
      const ctx = world[$internal];
      const resolvedTrait = resolveHookTrait(trait);
      const resolvedCallback = resolveHookCallback(trait, callback);

      let data = getTraitInstance(ctx.traitInstances, resolvedTrait);

      if (!data) {
        registerTrait(world, resolvedTrait);
        data = getTraitInstance(ctx.traitInstances, resolvedTrait)!;
      }

      data.removeSubscriptions.add(resolvedCallback);

      return () => data.removeSubscriptions.delete(resolvedCallback);
    },

    onChange(
      trait: Trait | Relation<Trait> | RelationPair<Trait>,
      callback: (entity: Entity, target?: Entity) => void
    ) {
      const ctx = world[$internal];
      const resolvedTrait = resolveHookTrait(trait);
      const resolvedCallback = resolveHookCallback(trait, callback);

      if (!hasTraitInstance(ctx.traitInstances, resolvedTrait)) registerTrait(world, resolvedTrait);

      const data = getTraitInstance(ctx.traitInstances, resolvedTrait)!;
      data.changeSubscriptions.add(resolvedCallback);

      ctx.trackedTraits.add(resolvedTrait);

      return () => {
        data.changeSubscriptions.delete(resolvedCallback);
        if (data.changeSubscriptions.size === 0) ctx.trackedTraits.delete(resolvedTrait);
      };
    },
  } as World;

  // Read-only properties via getters
  Object.defineProperty(world, 'id', {
    get: () => id,
    enumerable: true,
  });
  Object.defineProperty(world, 'isInitialized', {
    get: () => isInitialized,
    enumerable: true,
  });
  Object.defineProperty(world, 'entities', {
    get: () => getAliveEntities(world[$internal].entityIndex),
    enumerable: true,
  });

  // Handle initialization based on arguments
  if (
    optionsOrFirstTrait &&
    typeof optionsOrFirstTrait === 'object' &&
    !Array.isArray(optionsOrFirstTrait)
  ) {
    const { traits: optionTraits = [], lazy = false } = optionsOrFirstTrait as WorldOptions;
    if (!lazy) {
      world.init(...optionTraits);
    } else {
      lazyTraits = optionTraits;
    }
  } else {
    world.init(...(optionsOrFirstTrait ? [optionsOrFirstTrait, ...traits] : traits));
  }

  return world;
}
