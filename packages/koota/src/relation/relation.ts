import type { SparseSet } from '../collections';
import { $internal } from '../common';
import type { Entity } from '../entity/types';
import { getEntityId } from '../entity/utils/pack-entity';
import { isQuery } from '../query/utils/is-query';
import { checkQueryWithRelations } from '../query/utils/check-query-with-relations';
import type { Schema } from '../storage';
import { hasTrait, trait } from '../trait/trait';
import { getTraitInstance } from '../trait/trait-instance';
import type { QueryParameter } from '../query/types';
import type { Trait, TraitInstance } from '../trait/types';
import type { World } from '../world';
import type { Relation, RelationPair } from './types';
import { $relation, $relationPair } from './symbols';

/**
 * Creates a relation definition.
 * Relations are stored efficiently - one trait per relation type, not per target.
 * Targets are stored in TraitInstance.relationTargets.
 */
function createRelation<S extends Schema = Record<string, never>>(definition?: {
  exclusive?: boolean;
  autoDestroy?: 'orphan' | 'source' | 'target';
  /** @deprecated Use `autoDestroy: 'orphan'` instead */
  autoRemoveTarget?: boolean;
  store?: S;
}): Relation<Trait<S>> {
  // Create the underlying trait for this relation
  const relationTrait = trait(definition?.store ?? ({} as S)) as unknown as Trait<S>;
  const traitCtx = relationTrait[$internal];

  // Mark the trait as a relation trait
  traitCtx.relation = null!; // Will be set below after relation is created

  // Handle autoDestroy option - 'orphan' is an alias for 'source'
  let autoDestroy: 'source' | 'target' | false = false;
  if (definition?.autoDestroy === 'orphan' || definition?.autoDestroy === 'source') {
    autoDestroy = 'source';
  } else if (definition?.autoDestroy === 'target') {
    autoDestroy = 'target';
  }

  // Handle deprecated autoRemoveTarget option
  if (definition?.autoRemoveTarget) {
    console.warn("Koota: 'autoRemoveTarget' is deprecated. Use 'autoDestroy: \"orphan\"' instead.");
    autoDestroy = 'source';
  }

  const relationCtx = {
    trait: relationTrait,
    exclusive: definition?.exclusive ?? false,
    autoDestroy,
  };

  function relationFn(...args: any[]): RelationPair<Trait<S>> {
    const firstArg = args[0];
    if (firstArg === undefined) throw Error('Relation target is undefined');

    if (firstArg === '*' || typeof firstArg === 'number') {
      return {
        [$relationPair]: true,
        relation: relationFn as unknown as Relation<Trait<S>>,
        target: firstArg,
        params: args[1],
      };
    }

    if (isQuery(firstArg)) {
      if (args.length > 1) throw Error('Query relations do not accept additional parameters.');
      return {
        [$relationPair]: true,
        relation: relationFn as unknown as Relation<Trait<S>>,
        targetQuery: firstArg,
      };
    }

    return {
      [$relationPair]: true,
      relation: relationFn as unknown as Relation<Trait<S>>,
      targetQuery: args as QueryParameter[],
    };
  }

  const relation = Object.assign(relationFn, {
    [$internal]: relationCtx,
  }) as Relation<Trait<S>>;

  // Add symbol brand for fast type checking
  Object.defineProperty(relation, $relation, {
    value: true,
    writable: false,
    enumerable: false,
    configurable: false,
  });

  // Set the back-reference from trait to relation
  traitCtx.relation = relation;

  return relation;
}

export const relation = createRelation;

const EMPTY_ENTITY_ARRAY: readonly Entity[] = Object.freeze([]) as readonly Entity[];

function addToRelationSources(traitData: TraitInstance, entity: Entity, target: Entity): void {
  const buckets = (traitData.relationSourcesByTarget ??= []);
  const bucket = (buckets[getEntityId(target)] ??= []);
  bucket.push(entity);
}

function removeFromRelationSources(traitData: TraitInstance, entity: Entity, target: Entity): void {
  const bucket = traitData.relationSourcesByTarget?.[getEntityId(target)];
  if (!bucket) return;
  const idx = bucket.indexOf(entity);
  if (idx === -1) return;
  const last = bucket.length - 1;
  if (idx !== last) bucket[idx] = bucket[last];
  bucket.pop();
}

/**
 * Get the targets for a relation on an entity.
 * Returns an array of target entity IDs.
 */
export /* @inline */ function getRelationTargets(
  world: World,
  relation: Relation<Trait>,
  entity: Entity
): readonly Entity[] {
  const ctx = world[$internal];
  const relationCtx = relation[$internal];

  const traitData = getTraitInstance(ctx.traitInstances, relationCtx.trait);
  if (!traitData || !traitData.relationTargets) return [];

  const eid = getEntityId(entity);

  if (relationCtx.exclusive) {
    const target = (traitData.relationTargets as Array<Entity | undefined>)[eid];
    return target !== undefined ? [target as Entity] : [];
  } else {
    const targets = (traitData.relationTargets as number[][])[eid];
    return targets !== undefined ? (targets.slice() as Entity[]) : [];
  }
}

/**
 * Get the first target for a relation on an entity.
 * Returns the first target entity ID, or undefined if none exists.
 * Optimized version that avoids array allocation.
 */
export /* @inline */ function getFirstRelationTarget(
  world: World,
  relation: Relation<Trait>,
  entity: Entity
): Entity | undefined {
  const ctx = world[$internal];
  const relationCtx = relation[$internal];

  const traitData = getTraitInstance(ctx.traitInstances, relationCtx.trait);
  if (!traitData || !traitData.relationTargets) return undefined;

  const eid = getEntityId(entity);

  if (relationCtx.exclusive) {
    const target = (traitData.relationTargets as Array<Entity | undefined>)[eid];
    return target;
  } else {
    const targets = (traitData.relationTargets as number[][])[eid];
    return targets?.[0] as Entity | undefined;
  }
}

/**
 * Get the index of a target in the relation's target array.
 * Returns -1 if not found. Used for accessing per-target store data.
 */
export /* @inline */ function getTargetIndex(
  world: World,
  relation: Relation<Trait>,
  entity: Entity,
  target: Entity
): number {
  const ctx = world[$internal];
  const relationCtx = relation[$internal];
  const baseTrait = relationCtx.trait;

  const traitData = getTraitInstance(ctx.traitInstances, baseTrait);
  if (!traitData || !traitData.relationTargets) return -1;

  const eid = getEntityId(entity);

  if (relationCtx.exclusive) {
    return (traitData.relationTargets as Array<Entity | undefined>)[eid] === target ? 0 : -1;
  } else {
    const targets = (traitData.relationTargets as number[][])[eid];
    return targets ? targets.indexOf(target) : -1;
  }
}

/**
 * Check if an entity has a relation to a specific target.
 */
export /* @inline */ function hasRelationToTarget(
  world: World,
  relation: Relation<Trait>,
  entity: Entity,
  target: Entity
): boolean {
  const ctx = world[$internal];
  const relationCtx = relation[$internal];
  const baseTrait = relationCtx.trait;

  const traitData = getTraitInstance(ctx.traitInstances, baseTrait);
  if (!traitData || !traitData.relationTargets) return false;

  const eid = getEntityId(entity);

  if (relationCtx.exclusive) {
    return (traitData.relationTargets as Array<Entity | undefined>)[eid] === target;
  } else {
    const targets = (traitData.relationTargets as number[][])[eid];
    return targets ? targets.includes(target) : false;
  }
}

/**
 * Add a relation target to an entity.
 * Returns the index of the target in the targets array.
 * If the target already exists, returns -1.
 */
export function addRelationTarget(
  world: World,
  relation: Relation<Trait>,
  entity: Entity,
  target: Entity
): number {
  const ctx = world[$internal];
  const relationCtx = relation[$internal];
  const baseTrait = relationCtx.trait;

  const traitData = getTraitInstance(ctx.traitInstances, baseTrait);
  if (!traitData) return -1;

  if (!traitData.relationTargets) {
    traitData.relationTargets = [];
  }

  const eid = getEntityId(entity);

  let targetIndex: number;

  if (relationCtx.exclusive) {
    const targets = traitData.relationTargets as Array<Entity | undefined>;
    const previousTarget = targets[eid];
    // No-op if unchanged
    if (previousTarget === target) return -1;
    if (previousTarget !== undefined) {
      removeFromRelationSources(traitData, entity, previousTarget as Entity);
    }
    targets[eid] = target;
    targetIndex = 0;
  } else {
    const targetsArray = traitData.relationTargets as number[][];
    if (!targetsArray[eid]) {
      targetsArray[eid] = [];
    }

    // Check if already exists
    const existingIndex = targetsArray[eid].indexOf(target);
    if (existingIndex !== -1) {
      return -1;
    }

    targetIndex = targetsArray[eid].length;
    targetsArray[eid].push(target);
  }

  addToRelationSources(traitData, entity, target);
  updateQueriesForRelationChange(world, relation, entity);

  return targetIndex;
}

/**
 * Remove a relation target from an entity.
 * Returns the removed index and whether this was the last target.
 */
export function removeRelationTarget(
  world: World,
  relation: Relation<Trait>,
  entity: Entity,
  target: Entity
): { removedIndex: number; wasLastTarget: boolean } {
  const ctx = world[$internal];
  const relationCtx = relation[$internal];
  const relationTrait = relationCtx.trait;

  const data = getTraitInstance(ctx.traitInstances, relationTrait);
  if (!data || !data.relationTargets) return { removedIndex: -1, wasLastTarget: false };

  const eid = getEntityId(entity);

  let removedIndex = -1;
  let hasRemainingTargets = false;

  if (relationCtx.exclusive) {
    const targets = data.relationTargets as Array<Entity | undefined>;
    if (targets[eid] === target) {
      removeFromRelationSources(data, entity, target);
      targets[eid] = undefined;
      removedIndex = 0;
      hasRemainingTargets = false;
      clearRelationDataInternal(data.store, relationTrait[$internal].type, eid, 0, true);
    }
  } else {
    const targetsArray = data.relationTargets as number[][];
    const entityTargets = targetsArray[eid];
    if (entityTargets) {
      const idx = entityTargets.indexOf(target);
      if (idx !== -1) {
        const lastIdx = entityTargets.length - 1;
        removeFromRelationSources(data, entity, target);
        if (idx !== lastIdx) entityTargets[idx] = entityTargets[lastIdx];
        entityTargets.pop();
        swapAndPopRelationData(data.store, relationTrait[$internal].type, eid, idx, lastIdx);
        removedIndex = idx;
        hasRemainingTargets = entityTargets.length > 0;
      }
    }
  }

  if (removedIndex !== -1) updateQueriesForRelationChange(world, relation, entity);

  const wasLastTarget = removedIndex !== -1 && !hasRemainingTargets;
  return { removedIndex, wasLastTarget };
}

/**
 * Update queries when relation targets change.
 * Called after addRelationTarget or removeRelationTarget to keep queries in sync.
 */
function updateQueriesForRelationChange(
  world: World,
  relation: Relation<Trait>,
  entity: Entity
): void {
  const ctx = world[$internal];
  const baseTrait = relation[$internal].trait;
  const traitData = getTraitInstance(ctx.traitInstances, baseTrait);
  if (!traitData) return;

  // Update queries indexed by this relation (much faster than iterating all queries)
  // All queries in relationQueries already filter by this relation
  for (const query of traitData.relationQueries) {
    // Re-check entity against query
    const match = checkQueryWithRelations(world, query, entity);
    if (match) {
      query.add(entity);
    } else {
      query.remove(world, entity);
    }
  }
}

/** Swap-and-pop data arrays for non-exclusive relations */
function swapAndPopRelationData(
  store: any,
  type: string,
  eid: number,
  idx: number,
  lastIdx: number
): void {
  if (type === 'aos') {
    const arr = store[eid];
    if (arr) {
      if (idx !== lastIdx) arr[idx] = arr[lastIdx];
      arr.pop();
    }
  } else {
    for (const key in store) {
      const arr = store[key][eid];
      if (arr) {
        if (idx !== lastIdx) arr[idx] = arr[lastIdx];
        arr.pop();
      }
    }
  }
}

/** Clear data for exclusive relations */
function clearRelationDataInternal(
  store: any,
  type: string,
  eid: number,
  _idx: number,
  exclusive: boolean
): void {
  if (!exclusive) return;
  if (type === 'aos') {
    store[eid] = undefined;
  } else {
    for (const key in store) {
      store[key][eid] = undefined;
    }
  }
}

/**
 * Remove all relation targets from an entity.
 * Used for bulk removal when the base trait is also being removed.
 */
export function removeAllRelationTargets(
  world: World,
  relation: Relation<Trait>,
  entity: Entity
): void {
  const targets = getRelationTargets(world, relation, entity);
  for (const target of targets) {
    removeRelationTarget(world, relation, entity, target);
  }
}

/**
 * Get all entities that have a specific relation targeting a specific entity.
 * Returns a fresh snapshot so callers can safely iterate while relations mutate.
 */
export function getEntitiesWithRelationTo(
  world: World,
  relation: Relation<Trait>,
  target: Entity
): readonly Entity[] {
  const ctx = world[$internal];
  if (!world.has(target)) return EMPTY_ENTITY_ARRAY;

  const baseTrait = relation[$internal].trait;
  const traitData = getTraitInstance(ctx.traitInstances, baseTrait);
  if (!traitData?.relationSourcesByTarget) return EMPTY_ENTITY_ARRAY;
  return traitData.relationSourcesByTarget[getEntityId(target)]?.slice() ?? EMPTY_ENTITY_ARRAY;
}

export function hasRelationTargetInSet(
  world: World,
  relation: Relation<Trait>,
  entity: Entity,
  matches: SparseSet
): boolean {
  const ctx = world[$internal];
  const relationCtx = relation[$internal];
  const traitData = getTraitInstance(ctx.traitInstances, relationCtx.trait);
  if (!traitData?.relationTargets) return false;

  const eid = getEntityId(entity);

  if (relationCtx.exclusive) {
    const target = (traitData.relationTargets as Array<Entity | undefined>)[eid];
    return target !== undefined && matches.has(target);
  }

  const targets = (traitData.relationTargets as number[][])[eid];
  if (!targets) return false;

  for (let i = 0; i < targets.length; i++) {
    if (matches.has(targets[i]!)) return true;
  }

  return false;
}

/**
 * Set data for a specific relation target using target index.
 * For exclusive relations, index is always 0.
 * For non-exclusive, index corresponds to position in targets array.
 */
export function setRelationDataAtIndex(
  world: World,
  entity: Entity,
  relation: Relation<Trait>,
  targetIndex: number,
  value: Record<string, unknown>
): void {
  const relationCtx = relation[$internal];
  const baseTrait = relationCtx.trait;
  const traitData = getTraitInstance(world[$internal].traitInstances, baseTrait);
  if (!traitData) return;

  const store = traitData.store;
  const eid = getEntityId(entity);

  if (baseTrait[$internal].type === 'aos') {
    if (relationCtx.exclusive) {
      (store as unknown[])[eid] = value;
    } else {
      ((store as unknown[][])[eid] ??= [])[targetIndex] = value;
    }
    return;
  }

  // SoA
  if (relationCtx.exclusive) {
    for (const key in value) {
      (store as Record<string, unknown[]>)[key][eid] = (value as Record<string, unknown>)[key];
    }
  } else {
    for (const key in value) {
      (((store as Record<string, Array<unknown | unknown[]>>)[key][eid] ??= []) as unknown[])[
        targetIndex
      ] = (value as Record<string, unknown>)[key];
    }
  }
}

/**
 * Set data for a specific relation target.
 */
export function setRelationData(
  world: World,
  entity: Entity,
  relation: Relation<Trait>,
  target: Entity,
  value: Record<string, unknown>
): void {
  const targetIndex = getTargetIndex(world, relation, entity, target);
  if (targetIndex === -1) return;
  setRelationDataAtIndex(world, entity, relation, targetIndex, value);
}

/**
 * Get data for a specific relation target.
 */
export function getRelationData(
  world: World,
  entity: Entity,
  relation: Relation<Trait>,
  target: Entity
): unknown {
  const ctx = world[$internal];
  const baseTrait = relation[$internal].trait;
  const traitData = getTraitInstance(ctx.traitInstances, baseTrait);
  if (!traitData) return undefined;

  const targetIndex = getTargetIndex(world, relation, entity, target);
  if (targetIndex === -1) return undefined;

  const traitCtx = baseTrait[$internal];
  const store = traitData.store;
  const eid = getEntityId(entity);
  const relationCtx = relation[$internal];

  if (traitCtx.type === 'aos') {
    if (relationCtx.exclusive) {
      return (store as unknown[])[eid];
    } else {
      return (store as unknown[][])[eid]?.[targetIndex];
    }
  } else {
    // SoA: reconstruct object from store arrays
    const result: Record<string, unknown> = {};
    const storeRecord = store as Record<string, Array<unknown | unknown[]>>;
    for (const key in store) {
      if (relationCtx.exclusive) {
        result[key] = storeRecord[key][eid];
      } else {
        result[key] = (storeRecord[key][eid] as unknown[] | undefined)?.[targetIndex];
      }
    }
    return result;
  }
}

/**
 * Check if entity has a relation pair.
 */
export function hasRelationPair(world: World, entity: Entity, pair: RelationPair): boolean {
  const relation = pair.relation;
  const target = pair.target;
  const targetQuery = pair.targetQuery;

  // Check if entity has the base trait
  if (!hasTrait(world, entity, relation[$internal].trait)) return false;

  if (targetQuery) {
    const matchingTargets = isQuery(targetQuery)
      ? world.query(targetQuery)
      : world.query(...targetQuery);
    if (!matchingTargets.length) return false;

    const targets = getRelationTargets(world, relation, entity);
    for (let i = 0; i < targets.length; i++) {
      if (matchingTargets.includes(targets[i])) return true;
    }

    return false;
  }

  // Wildcard target
  if (target === '*') return true;

  // Specific target
  if (typeof target === 'number') return hasRelationToTarget(world, relation, entity, target);

  return false;
}
