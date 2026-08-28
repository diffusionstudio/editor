import { $internal } from '../common';
import type { Entity } from '../entity/types';
import { getEntityId } from '../entity/utils/pack-entity';
import { setChanged, setPairChanged } from '../query/modifiers/changed';
import { checkQueryTrackingWithRelations } from '../query/utils/check-query-tracking-with-relations';
import { checkQueryWithRelations } from '../query/utils/check-query-with-relations';
import { getOrderedTraitRelation, isOrderedTrait, setupOrderedTraitSync } from '../relation/ordered';
import { OrderedList } from '../relation/ordered-list';
import {
  addRelationTarget,
  getFirstRelationTarget,
  getRelationData,
  getRelationTargets,
  hasRelationPair,
  hasRelationToTarget,
  removeAllRelationTargets,
  removeRelationTarget,
  setRelationData,
  setRelationDataAtIndex,
} from '../relation/relation';
import type { OrderedRelation, Relation, RelationPair } from '../relation/types';
import { isRelationPair } from '../relation/utils/is-relation';
import {
  createFastSetChangeFunction,
  createFastSetFunction,
  createGetFunction,
  createSetFunction,
  createStore,
  getSchemaDefaults,
  type Norm,
  type Schema,
  type StoreType,
  validateSchema,
} from '../storage';
import type { World } from '../world';
import { incrementWorldBitflag } from '../world/utils/increment-world-bit-flag';
import { getTraitInstance, hasTraitInstance, setTraitInstance } from './trait-instance';
import type {
  ConfigurableTrait,
  ExtractStore,
  TagTrait,
  Trait,
  TraitInstance,
  TraitValue,
} from './types';

// No reason to create a new object every time a tag trait is created.
const tagSchema = Object.freeze({});
let traitId = 0;

function createTrait(schema?: undefined | Record<string, never>): TagTrait;
function createTrait<S extends Schema>(schema: S): Trait<Norm<S>>;
function createTrait<S extends Schema>(schema: S = tagSchema as S): Trait<Norm<S>> {
  const isAoS = typeof schema === 'function';
  const isTag = !isAoS && Object.keys(schema).length === 0;
  const traitType: StoreType = isAoS ? 'aos' : isTag ? 'tag' : 'soa';

  validateSchema(schema);

  const id = traitId++;
  const Trait = Object.assign((params: TraitValue<Norm<S>>) => [Trait, params], {
    [$internal]: {
      id: id,
      set: createSetFunction[traitType](schema),
      fastSet: createFastSetFunction[traitType](schema),
      fastSetWithChangeDetection: createFastSetChangeFunction[traitType](schema),
      get: createGetFunction[traitType](schema),
      createStore: () => createStore<S>(schema),
      relation: null,
      type: traitType,
    },
  }) as Trait<Norm<S>>;

  // Add public read-only properties
  Object.defineProperty(Trait, 'id', {
    value: id,
    writable: false,
    enumerable: true,
    configurable: false,
  });

  Object.defineProperty(Trait, 'schema', {
    value: schema,
    writable: false,
    enumerable: true,
    configurable: false,
  });

  return Trait;
}

export const trait = createTrait;

export function registerTrait(world: World, trait: Trait) {
  const ctx = world[$internal];
  const traitCtx = trait[$internal];

  const data: TraitInstance = {
    generationId: ctx.entityMasks.length - 1,
    bitflag: ctx.bitflag,
    trait,
    store: traitCtx.createStore(),
    queries: new Set(),
    trackingQueries: new Set(),
    notQueries: new Set(),
    relationQueries: new Set(),
    schema: trait.schema,
    changeSubscriptions: new Set(),
    addSubscriptions: new Set(),
    removeSubscriptions: new Set(),
  };

  // Add trait to the world.
  setTraitInstance(ctx.traitInstances, trait, data);
  world.traits.add(trait);

  // Track relations
  if (traitCtx.relation) ctx.relations.add(traitCtx.relation);

  // This ensures nested trait registrations get different bitflags.
  incrementWorldBitflag(world);

  // Setup ordered trait sync if this is an ordered trait
  if (isOrderedTrait(trait)) setupOrderedTraitSync(world, trait);
}

function getOrderedTrait(world: World, entity: Entity, trait: OrderedRelation): OrderedList {
  const relation = getOrderedTraitRelation(trait);
  return new OrderedList(world, entity, relation, trait);
}

export function addTrait(world: World, entity: Entity, ...traits: ConfigurableTrait[]) {
  for (let i = 0; i < traits.length; i++) {
    const config = traits[i];

    // Handle relation pairs
    if (isRelationPair(config)) {
      addRelationPair(world, entity, config);
      continue;
    }

    // Get trait and params for regular traits
    let trait: Trait;
    let params: Record<string, any> | undefined;

    if (Array.isArray(config)) {
      [trait, params] = config as [Trait, Record<string, any>];
    } else {
      trait = config as Trait;
    }

    // Add the trait to the entity
    const data = addTraitToEntity(world, entity, trait);
    if (!data) continue; // Already had the trait

    // Initialize values
    const traitCtx = trait[$internal];

    const defaults = isOrderedTrait(trait)
      ? getOrderedTrait(world, entity, trait)
      : getSchemaDefaults(data.schema, traitCtx.type);

    if (traitCtx.type === 'aos') {
      setTrait(world, entity, trait, params ?? defaults, false);
    } else if (defaults) {
      setTrait(world, entity, trait, { ...defaults, ...params }, false);
    } else if (params) {
      setTrait(world, entity, trait, params, false);
    }

    // Call add subscriptions after values are set
    for (const sub of data.addSubscriptions) sub(entity);
  }
}

/**
 * Add a relation pair to an entity.
 */
/* @inline */ function addRelationPair(world: World, entity: Entity, pair: RelationPair) {
  const relation = pair.relation;
  const target = pair.target;

  // Only specific targets can be added (not wildcard '*')
  if (typeof target !== 'number') return;

  const params = pair.params;
  const relationCtx = relation[$internal];
  const relationTrait = relationCtx.trait;

  // Ignore if entity already relates to this target
  // For example, adding Likes(alice) when this pair is already on the entity.
  if (hasRelationToTarget(world, relation, entity, target)) return;

  // For exclusive relations, remove the old target first
  if (relationCtx.exclusive) {
    const oldTarget = getFirstRelationTarget(world, relation, entity);
    if (oldTarget !== undefined && oldTarget !== target) {
      const instance = getTraitInstance(world[$internal].traitInstances, relationTrait);
      if (instance) {
        for (const sub of instance.removeSubscriptions) sub(entity, oldTarget);
      }
      removeRelationTarget(world, relation, entity, oldTarget);
    }
  }

  let instance = addTraitToEntity(world, entity, relationTrait);

  const targetIndex = addRelationTarget(world, relation, entity, target);
  if (targetIndex === -1) return; // No-op

  const schema =
    instance?.schema ?? getTraitInstance(world[$internal].traitInstances, relationTrait)!.schema;
  const defaults = getSchemaDefaults(schema, relationTrait[$internal].type);

  if (defaults) {
    setRelationDataAtIndex(world, entity, relation, targetIndex, { ...defaults, ...params });
  } else if (params) {
    setRelationDataAtIndex(world, entity, relation, targetIndex, params);
  }

  // Fire add subscription for this pair
  instance = instance ?? getTraitInstance(world[$internal].traitInstances, relationTrait)!;
  for (const sub of instance.addSubscriptions) sub(entity, target);
}

export function removeTrait(world: World, entity: Entity, ...traits: (Trait | RelationPair)[]) {
  for (let i = 0; i < traits.length; i++) {
    const trait = traits[i];

    if (isRelationPair(trait)) {
      removeRelationPair(world, entity, trait);
      continue;
    }

    if (!hasTrait(world, entity, trait)) continue;

    const traitCtx = trait[$internal];

    if (traitCtx.relation) {
      // Relation trait: emit per-pair removes, then teardown
      const instance = getTraitInstance(world[$internal].traitInstances, trait);
      if (instance) {
        const targets = getRelationTargets(world, traitCtx.relation, entity);
        for (const t of targets) {
          for (const sub of instance.removeSubscriptions) sub(entity, t);
        }
      }
      removeAllRelationTargets(world, traitCtx.relation, entity);
    } else {
      // Regular trait: emit generic remove
      const instance = getTraitInstance(world[$internal].traitInstances, trait);
      if (instance) {
        for (const sub of instance.removeSubscriptions) sub(entity);
      }
    }

    removeTraitFromEntity(world, entity, trait);
  }
}

/* @inline */ function removeRelationPair(world: World, entity: Entity, pair: RelationPair) {
  const relation = pair.relation;
  const target = pair.target;
  const relationTrait = relation[$internal].trait;

  if (!hasTrait(world, entity, relationTrait)) return;

  const instance = getTraitInstance(world[$internal].traitInstances, relationTrait);

  if (target === '*') {
    if (instance) {
      const targets = getRelationTargets(world, relation, entity);
      for (const t of targets) {
        for (const sub of instance.removeSubscriptions) sub(entity, t);
      }
    }
    removeAllRelationTargets(world, relation, entity);
    removeTraitFromEntity(world, entity, relationTrait);
    return;
  }

  if (typeof target === 'number') {
    if (instance) {
      for (const sub of instance.removeSubscriptions) sub(entity, target);
    }

    const { removedIndex, wasLastTarget } = removeRelationTarget(world, relation, entity, target);
    if (removedIndex === -1) return;

    if (wasLastTarget) removeTraitFromEntity(world, entity, relationTrait);
  }
}

/**
 * Remove a relation target and clean up the base trait if it was the last target.
 * This is used by entity destruction to ensure proper cleanup.
 */
export function cleanupRelationTarget(
  world: World,
  relation: Relation<Trait>,
  entity: Entity,
  target: Entity
): void {
  const relationTrait = relation[$internal].trait;

  const instance = getTraitInstance(world[$internal].traitInstances, relationTrait);
  if (instance) {
    for (const sub of instance.removeSubscriptions) sub(entity, target);
  }

  const { removedIndex, wasLastTarget } = removeRelationTarget(world, relation, entity, target);
  if (removedIndex === -1) return;

  if (wasLastTarget) removeTraitFromEntity(world, entity, relationTrait);
}

export function hasTrait(world: World, entity: Entity, trait: Trait): boolean {
  const ctx = world[$internal];
  const instance = getTraitInstance(ctx.traitInstances, trait);
  if (!instance) return false;

  const { generationId, bitflag } = instance;
  const eid = getEntityId(entity);
  const mask = ctx.entityMasks[generationId][eid];

  return (mask & bitflag) === bitflag;
}

export /* @inline @pure */ function getStore<C extends Trait = Trait>(
  world: World,
  trait: C
): ExtractStore<C> {
  const ctx = world[$internal];
  const instance = getTraitInstance(ctx.traitInstances, trait)!;
  return instance.store as ExtractStore<C>;
}

export function setTrait(
  world: World,
  entity: Entity,
  trait: Trait | RelationPair,
  value: any,
  triggerChanged = true
) {
  if (isRelationPair(trait)) return setTraitForPair(world, entity, trait, value, triggerChanged);
  return setTraitForTrait(world, entity, trait, value, triggerChanged);
}

export function getTrait(world: World, entity: Entity, trait: Trait | RelationPair) {
  if (isRelationPair(trait)) return getTraitForPair(world, entity, trait);
  return getTraitForTrait(world, entity, trait);
}

/**
 * Get trait data for a relation pair.
 */
/* @inline @pure */ function getTraitForPair(world: World, entity: Entity, pair: RelationPair) {
  const relation = pair.relation as Relation<Trait>;
  const target = pair.target;

  if (!hasRelationPair(world, entity, pair)) return undefined;
  if (typeof target !== 'number') return undefined;

  return getRelationData(world, entity, relation, target);
}

/**
 * Get trait data for a regular trait.
 */
/* @inline @pure */ function getTraitForTrait(world: World, entity: Entity, trait: Trait) {
  if (!hasTrait(world, entity, trait)) return undefined;

  const traitCtx = trait[$internal];
  const store = getStore(world, trait);
  const data = traitCtx.get(getEntityId(entity), store);

  return data;
}

/**
 * Set trait data for a relation pair.
 */
/* @inline */ function setTraitForPair(
  world: World,
  entity: Entity,
  pair: RelationPair,
  value: any,
  triggerChanged: boolean
) {
  const relation = pair.relation as Relation<Trait>;
  const target = pair.target;

  if (typeof target !== 'number') return;

  setRelationData(world, entity, relation, target, value);
  if (triggerChanged) setPairChanged(world, entity, relation[$internal].trait, target);
}

/**
 * Set trait data for a regular trait.
 */
/* @inline */ function setTraitForTrait(
  world: World,
  entity: Entity,
  trait: Trait,
  value: any,
  triggerChanged: boolean
) {
  const ctx = trait[$internal];
  const store = getStore(world, trait);
  const index = getEntityId(entity);

  // A short circuit is more performance than an if statement which creates a new code statement.
  value instanceof Function && (value = value(ctx.get(index, store)));

  ctx.set(index, store, value);
  triggerChanged && setChanged(world, entity, trait);
}

/**
 * Core logic for adding a trait to an entity.
 */
/* @inline */ function addTraitToEntity(
  world: World,
  entity: Entity,
  trait: Trait
): TraitInstance | undefined {
  // Exit early if the entity already has the trait
  if (hasTrait(world, entity, trait)) return undefined;

  const ctx = world[$internal];

  // Register the trait if it's not already registered
  if (!hasTraitInstance(ctx.traitInstances, trait)) registerTrait(world, trait);

  const instance = getTraitInstance(ctx.traitInstances, trait)!;
  const { generationId, bitflag, queries, trackingQueries } = instance;

  // Add bitflag to entity bitmask
  const eid = getEntityId(entity);
  ctx.entityMasks[generationId][eid] |= bitflag;

  // Set the entity as dirty
  for (const dirtyMask of ctx.dirtyMasks.values()) {
    if (!dirtyMask[generationId]) dirtyMask[generationId] = [];
    dirtyMask[generationId][eid] |= bitflag;
  }

  // Update non-tracking queries (no event data needed)
  for (const query of queries) {
    query.toRemove.remove(entity);
    // Use checkQueryWithRelations if query has relation filters, otherwise use checkQuery
    const match =
      query.relationFilters && query.relationFilters.length > 0
        ? checkQueryWithRelations(world, query, entity)
        : query.check(world, entity);
    if (match) query.add(entity);
    else query.remove(world, entity);
  }

  // Update tracking queries (with event data)
  for (const query of trackingQueries) {
    query.toRemove.remove(entity);
    // Use checkQueryTrackingWithRelations if query has relation filters, otherwise use checkQueryTracking
    const match =
      query.relationFilters && query.relationFilters.length > 0
        ? checkQueryTrackingWithRelations(world, query, entity, 'add', generationId, bitflag)
        : query.checkTracking(world, entity, 'add', generationId, bitflag);
    if (match) query.add(entity);
    else query.remove(world, entity);
  }

  // Add trait to entity internally
  ctx.entityTraits.get(entity)!.add(trait);

  return instance;
}

/**
 * Core logic for removing a trait from an entity.
 * Does not emit remove subscriptions — callers handle emission.
 */
function removeTraitFromEntity(world: World, entity: Entity, trait: Trait): void {
  if (!hasTrait(world, entity, trait)) return;

  const ctx = world[$internal];
  const instance = getTraitInstance(ctx.traitInstances, trait)!;
  const { generationId, bitflag, queries, trackingQueries } = instance;

  // Remove bitflag from entity bitmask
  const eid = getEntityId(entity);
  ctx.entityMasks[generationId][eid] &= ~bitflag;

  // Set the entity as dirty
  for (const dirtyMask of ctx.dirtyMasks.values()) {
    dirtyMask[generationId][eid] |= bitflag;
  }

  // Update non-tracking queries
  for (const query of queries) {
    // Use checkQueryWithRelations if query has relation filters, otherwise use checkQuery
    const match =
      query.relationFilters && query.relationFilters.length > 0
        ? checkQueryWithRelations(world, query, entity)
        : query.check(world, entity);
    if (match) query.add(entity);
    else query.remove(world, entity);
  }

  // Update tracking queries (with event data)
  for (const query of trackingQueries) {
    // Use checkQueryTrackingWithRelations if query has relation filters, otherwise use checkQueryTracking
    const match =
      query.relationFilters && query.relationFilters.length > 0
        ? checkQueryTrackingWithRelations(world, query, entity, 'remove', generationId, bitflag)
        : query.checkTracking(world, entity, 'remove', generationId, bitflag);
    if (match) query.add(entity);
    else query.remove(world, entity);
  }

  // Remove trait from entity internally
  ctx.entityTraits.get(entity)!.delete(trait);
}
