import { SparseSet } from '../collections';
import { $internal } from '../common';
import type { Entity } from '../entity/types';
import { getEntityId } from '../entity/utils/pack-entity';
import { getEntitiesWithRelationTo, hasRelationPair } from '../relation/relation';
import type { Relation } from '../relation/types';
import { isRelationPair } from '../relation/utils/is-relation';
import { registerTrait, trait } from '../trait/trait';
import { getTraitInstance, hasTraitInstance } from '../trait/trait-instance';
import type { TagTrait, Trait } from '../trait/types';
import { universe } from '../universe/universe';
import type { World } from '../world';
import { getTrackingType, isModifier, isOrWithModifiers, isTrackingModifier } from './modifier';
import { createQueryResult } from './query-result';
import { $queryRef } from './symbols';
import {
  type EventType,
  type Modifier,
  type Query,
  type QueryInstance,
  type QueryParameter,
  type QueryResult,
  type ResolvedRelationFilter,
  type QuerySubscriber,
  type TrackingGroup,
} from './types';
import { checkQuery } from './utils/check-query';
import { checkQueryTracking } from './utils/check-query-tracking';
import { checkQueryWithRelations } from './utils/check-query-with-relations';
import { createQueryHash } from './utils/create-query-hash';
import { isQuery } from './utils/is-query';

export const IsExcluded: TagTrait = trait();

function resolveRelationFilter(filter: ResolvedRelationFilter): ResolvedRelationFilter {
  if (!filter.targetQuery) return filter;

  const targetQueryRef = isQuery(filter.targetQuery)
    ? filter.targetQuery
    : createQuery(...filter.targetQuery);

  return {
    ...filter,
    targetQueryRef,
    targetQueryMatches: new SparseSet(),
  };
}

export function runQuery<T extends QueryParameter[]>(
  world: World,
  query: QueryInstance<T>,
  params: QueryParameter[]
): QueryResult<T> {
  commitQueryRemovals(world);

  // With hybrid bitmask strategy, query.entities is already incrementally maintained
  // with both trait and relation filters applied. Just return the pre-filtered entities.
  const entities = query.entities.dense.slice() as Entity[];

  // Clear so it can accumulate again.
  if (query.isTracking) {
    query.entities.clear();
    // PERF: Use indexed loop instead of for...of
    const len = entities.length;
    for (let i = 0; i < len; i++) {
      query.resetTrackingBitmasks(entities[i]);
    }
  }

  return createQueryResult(world, entities, query, params);
}

export function addEntityToQuery(query: QueryInstance, entity: Entity) {
  query.toRemove.remove(entity);
  query.entities.add(entity);

  // Notify subscriptions.
  for (const sub of query.addSubscriptions) {
    sub(entity);
  }

  query.version++;
}

export function removeEntityFromQuery(world: World, query: QueryInstance, entity: Entity) {
  if (!query.entities.has(entity) || query.toRemove.has(entity)) return;

  const ctx = world[$internal];

  query.toRemove.add(entity);
  ctx.dirtyQueries.add(query);

  // Notify subscriptions.
  for (const sub of query.removeSubscriptions) {
    sub(entity);
  }

  query.version++;
}

export function commitQueryRemovals(world: World) {
  const ctx = world[$internal];
  if (!ctx.dirtyQueries.size) return;

  for (const query of ctx.dirtyQueries) {
    for (let i = query.toRemove.dense.length - 1; i >= 0; i--) {
      const eid = query.toRemove.dense[i];
      query.toRemove.remove(eid);
      query.entities.remove(eid);
    }
  }

  ctx.dirtyQueries.clear();
}

/** Reset tracking state for an entity across all tracking groups */
export function resetQueryTrackingBitmasks(query: QueryInstance, eid: number) {
  const groups = query.trackingGroups;
  const len = groups.length;
  for (let i = 0; i < len; i++) {
    const trackers = groups[i].trackers;
    const trackersLen = trackers.length;
    for (let j = 0; j < trackersLen; j++) {
      const tracker = trackers[j];
      if (tracker) tracker[eid] = 0;
    }
  }
}

/**
 * Unified function to process tracking modifiers with explicit AND/OR logic.
 * Groups modifiers by (type, id, logic) key so same-tracker calls are combined.
 */
function processTrackingModifier(
  world: World,
  query: QueryInstance,
  modifier: Modifier,
  logic: 'and' | 'or',
  ctx: World[typeof $internal],
  groupsMap: Map<string, TrackingGroup>
): void {
  const trackingType = getTrackingType(modifier);
  if (!trackingType) return;

  const id = modifier.id;
  // Key includes logic so Changed(A) at top-level stays separate from Or(Changed(A))
  const key = `${trackingType}-${id}-${logic}`;

  // Find or create tracking group
  let group = groupsMap.get(key);
  if (!group) {
    group = {
      logic,
      type: trackingType,
      id,
      bitmasks: [],
      trackers: [],
    };
    groupsMap.set(key, group);
    query.trackingGroups.push(group);
  }

  // Register traits and build bitmasks
  for (const trait of modifier.traits) {
    if (!hasTraitInstance(ctx.traitInstances, trait)) registerTrait(world, trait);
    const instance = getTraitInstance(ctx.traitInstances, trait)!;
    query.traits.push(trait);

    // Add to traitInstances.all for query registration
    query.traitInstances.all.push(instance);

    // Build bitmasks by generation
    const genId = instance.generationId;
    group.bitmasks[genId] = (group.bitmasks[genId] || 0) | instance.bitflag;

    // Track changed traits for change detection in query-result
    if (trackingType === 'change') {
      query.changedTraits.add(trait);
      query.hasChangedModifiers = true;
    }
  }

  query.isTracking = true;
}

export function createQueryInstance<T extends QueryParameter[]>(
  world: World,
  parameters: T
): QueryInstance {
  const query: QueryInstance = {
    version: 0,
    world,
    parameters,
    hash: '',
    traits: [],
    traitInstances: {
      required: [],
      forbidden: [],
      or: [],
      all: [],
    },
    staticBitmasks: [],
    trackingGroups: [],
    generations: [],
    entities: new SparseSet(),
    isTracking: false,
    hasChangedModifiers: false,
    changedTraits: new Set<Trait>(),
    toRemove: new SparseSet(),
    cleanup: [],
    addSubscriptions: new Set<QuerySubscriber>(),
    removeSubscriptions: new Set<QuerySubscriber>(),
    relationFilters: [],

    run: (world: World, params: QueryParameter[]) => runQuery(world, query, params),
    add: (entity: Entity) => addEntityToQuery(query, entity),
    remove: (world: World, entity: Entity) => removeEntityFromQuery(world, query, entity),
    check: (world: World, entity: Entity) => checkQuery(world, query, entity),
    checkTracking: (
      world: World,
      entity: Entity,
      eventType: EventType,
      generationId: number,
      bitflag: number
    ) => checkQueryTracking(world, query, entity, eventType, generationId, bitflag),
    resetTrackingBitmasks: (eid: number) => resetQueryTrackingBitmasks(query, eid),
  };

  const ctx = world[$internal];

  // Map for grouping tracking modifiers by (type, id, logic)
  const trackingGroupsMap = new Map<string, TrackingGroup>();

  // Process all parameters
  for (let i = 0; i < parameters.length; i++) {
    const parameter = parameters[i];

    // Handle relation pairs
    if (isRelationPair(parameter)) {
      const relation = parameter.relation;
      query.relationFilters!.push(resolveRelationFilter(parameter));

      const baseTrait = (relation as Relation<Trait>)[$internal].trait;
      if (!hasTraitInstance(ctx.traitInstances, baseTrait)) registerTrait(world, baseTrait);
      query.traitInstances.required.push(getTraitInstance(ctx.traitInstances, baseTrait)!);
      query.traits.push(baseTrait);

      continue;
    }

    if (isModifier(parameter)) {
      const traits = parameter.traits;

      // Register traits
      for (let j = 0; j < traits.length; j++) {
        const t = traits[j];
        if (!hasTraitInstance(ctx.traitInstances, t)) registerTrait(world, t);
      }

      if (parameter.type === 'not') {
        query.traitInstances.forbidden.push(
          ...traits.map((t) => getTraitInstance(ctx.traitInstances, t)!)
        );
      } else if (parameter.type === 'or') {
        // Handle regular traits in Or
        query.traitInstances.or.push(...traits.map((t) => getTraitInstance(ctx.traitInstances, t)!));

        // Handle nested tracking modifiers in Or
        if (isOrWithModifiers(parameter)) {
          for (const nestedModifier of parameter.modifiers) {
            if (isTrackingModifier(nestedModifier)) {
              processTrackingModifier(world, query, nestedModifier, 'or', ctx, trackingGroupsMap);
            }
          }
        }
      } else if (isTrackingModifier(parameter)) {
        // Top-level tracking modifiers use AND logic
        processTrackingModifier(world, query, parameter, 'and', ctx, trackingGroupsMap);
      }
    } else {
      // Regular trait
      const t = parameter as Trait;
      if (!hasTraitInstance(ctx.traitInstances, t)) registerTrait(world, t);
      query.traitInstances.required.push(getTraitInstance(ctx.traitInstances, t)!);
      query.traits.push(t);
    }
  }

  // Add IsExcluded to the forbidden list
  query.traitInstances.forbidden.push(getTraitInstance(ctx.traitInstances, IsExcluded)!);

  // Build traitInstances.all from static instances (tracking instances already added by processTrackingModifier)
  query.traitInstances.all = [
    ...query.traitInstances.all, // Tracking instances added by processTrackingModifier
    ...query.traitInstances.required,
    ...query.traitInstances.forbidden,
    ...query.traitInstances.or,
  ];

  // Create an array of all trait generations
  query.generations = query.traitInstances.all
    .map((c) => c.generationId)
    .reduce((a: number[], v) => {
      if (a.includes(v)) return a;
      a.push(v);
      return a;
    }, []);

  // Create static bitmasks (required/forbidden/or only - tracking is in trackingGroups)
  query.staticBitmasks = query.generations.map((generationId) => {
    const required = query.traitInstances.required
      .filter((c) => c.generationId === generationId)
      .reduce((a, c) => a | c.bitflag, 0);

    const forbidden = query.traitInstances.forbidden
      .filter((c) => c.generationId === generationId)
      .reduce((a, c) => a | c.bitflag, 0);

    const or = query.traitInstances.or
      .filter((c) => c.generationId === generationId)
      .reduce((a, c) => a | c.bitflag, 0);

    return { required, forbidden, or };
  });

  // Create hash
  query.hash = createQueryHash(parameters);

  // Add to world
  ctx.queriesHashMap.set(query.hash, query);

  // Register query with trait instances
  if (query.isTracking) {
    query.traitInstances.all.forEach((instance) => {
      instance.trackingQueries.add(query);
    });
  } else {
    query.traitInstances.all.forEach((instance) => {
      instance.queries.add(query);
    });
  }

  // Add to notQueries if has forbidden traits
  if (query.traitInstances.forbidden.length > 0) ctx.notQueries.add(query);

  // Index queries with relation filters
  const hasRelationFilters = query.relationFilters && query.relationFilters.length > 0;

  if (hasRelationFilters) {
    for (const pair of query.relationFilters!) {
      const relationTrait = pair.relation[$internal].trait;
      const relationTraitInstance = getTraitInstance(ctx.traitInstances, relationTrait);
      if (relationTraitInstance) {
        relationTraitInstance.relationQueries.add(query);
      }

      if (pair.targetQueryRef && pair.targetQueryMatches) {
        const matchingTargets = world.query(pair.targetQueryRef);
        for (let i = 0; i < matchingTargets.length; i++) {
          pair.targetQueryMatches.add(matchingTargets[i]);
        }

        const refreshSourcesForTarget = (target: Entity) => {
          const sources = getEntitiesWithRelationTo(world, pair.relation as Relation<Trait>, target);
          for (let i = 0; i < sources.length; i++) {
            const source = sources[i];
            const match = checkQueryWithRelations(world, query, source);
            if (match) {
              query.add(source);
            } else {
              query.remove(world, source);
            }
          }
        };

        query.cleanup.push(
          world.onQueryAdd(pair.targetQueryRef, (target) => {
            pair.targetQueryMatches!.add(target);
            refreshSourcesForTarget(target);
          })
        );
        query.cleanup.push(
          world.onQueryRemove(pair.targetQueryRef, (target) => {
            pair.targetQueryMatches!.remove(target);
            refreshSourcesForTarget(target);
          })
        );
      }
    }
  }

  // Populate query with initial matching entities
  if (query.trackingGroups.length > 0) {
    // For tracking queries, check each entity against tracking groups
    for (const group of query.trackingGroups) {
      const { type, id, logic, bitmasks } = group;
      const snapshot = ctx.trackingSnapshots.get(id)!;
      const dirtyMask = ctx.dirtyMasks.get(id)!;
      const changedMask = ctx.changedMasks.get(id)!;

      for (const entity of ctx.entityIndex.dense) {
        // For AND groups, skip if already in query (will be checked by other groups)
        // For OR groups, skip if already in query
        if (query.entities.has(entity)) continue;

        const eid = getEntityId(entity);
        let matches = logic === 'and'; // AND starts true, OR starts false

        // Check each generation that has bitmasks
        for (let genId = 0; genId < bitmasks.length; genId++) {
          const mask = bitmasks[genId];
          if (!mask) continue;

          const oldMask = snapshot[genId]?.[eid] || 0;
          const currentMask = ctx.entityMasks[genId]?.[eid] || 0;

          // Check each bit in the mask
          for (let bit = 1; bit <= mask; bit <<= 1) {
            if (!(mask & bit)) continue;

            let traitMatches = false;

            switch (type) {
              case 'add':
                traitMatches = (oldMask & bit) === 0 && (currentMask & bit) === bit;
                break;
              case 'remove':
                traitMatches =
                  ((oldMask & bit) === bit && (currentMask & bit) === 0) ||
                  ((oldMask & bit) === 0 &&
                    (currentMask & bit) === 0 &&
                    ((dirtyMask[genId]?.[eid] ?? 0) & bit) === bit);
                break;
              case 'change':
                traitMatches = ((changedMask[genId]?.[eid] ?? 0) & bit) === bit;
                break;
            }

            if (logic === 'and') {
              if (!traitMatches) {
                matches = false;
                break;
              }
            } else {
              // OR logic
              if (traitMatches) {
                matches = true;
                break;
              }
            }
          }

          // Early exit for AND that failed or OR that succeeded
          if (logic === 'and' && !matches) break;
          if (logic === 'or' && matches) break;
        }

        if (matches) {
          if (hasRelationFilters) {
            let relationMatch = true;
            for (const pair of query.relationFilters!) {
              if (!hasRelationPair(world, entity, pair)) {
                relationMatch = false;
                break;
              }
            }
            if (relationMatch) query.add(entity);
          } else {
            query.add(entity);
          }
        }
      }
    }
  } else {
    // Non-tracking query: populate immediately
    const entities = ctx.entityIndex.dense;
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      const match = hasRelationFilters
        ? checkQueryWithRelations(world, query, entity)
        : query.check(world, entity);
      if (match) query.add(entity);
    }
  }

  return query;
}

let queryId = 0;

export function createQuery<T extends QueryParameter[]>(...parameters: T): Query<T> {
  const hash = createQueryHash(parameters);

  // Check if this query was already cached
  const existing = universe.cachedQueries.get(hash);
  if (existing) return existing as Query<T>;

  // Create new query ref with ID
  const id = queryId++;
  const queryRef = Object.freeze({
    [$queryRef]: true,
    id,
    hash,
    parameters,
  }) as Query<T>;

  // Cache the ref for deduplication and stable IDs
  universe.cachedQueries.set(hash, queryRef);

  return queryRef;
}
