export { createActions } from './actions/create-actions';
export type { Actions, ActionsInitializer, ActionRecord } from './actions/types';
export { $internal } from './common';
export type { Entity } from './entity/types';
export { unpackEntity } from './entity/utils/pack-entity';
export { shallowEqual } from './utils/shallow-equal';
export { createAdded } from './query/modifiers/added';
export { createChanged } from './query/modifiers/changed';
export { Not } from './query/modifiers/not';
export { Or } from './query/modifiers/or';
export { createRemoved } from './query/modifiers/removed';
export { $modifier } from './query/modifier';
export { createQuery, IsExcluded } from './query/query';
export type {
  EventType,
  InstancesFromParameters,
  IsNotModifier,
  Modifier,
  Query,
  QueryModifier,
  QueryParameter,
  QueryResult,
  QueryResultOptions,
  QuerySubscriber,
  QueryUnsubscriber,
  QueryHash,
  StoresFromParameters,
} from './query/types';
export { $queryRef } from './query/symbols';
export { relation } from './relation/relation';
/** @experimental This API is experimental and may change or be removed in future versions. */
export { ordered } from './relation/ordered';
/** @experimental This API is experimental and may change or be removed in future versions. */
export { OrderedList } from './relation/ordered-list';
export { $relationPair, $relation } from './relation/symbols';
export type {
  /** @experimental This type is experimental and may change or be removed in future versions. */
  OrderedRelation as OrderedTrait,
  RelationInputTarget,
  Relation,
  RelationPair,
  RelationTarget,
} from './relation/types';
export { getStore, trait } from './trait/trait';
export type {
  ConfigurableTrait,
  ExtractIsTag,
  ExtractSchema,
  ExtractStore,
  IsTag,
  SetTraitCallback,
  TagTrait,
  Trait,
  TraitRecord,
  TraitTuple,
  TraitValue,
} from './trait/types';
export type { AoSFactory, Norm, Schema, Store, StoreType } from './storage/types';
export type { TraitType } from './trait/types';
export { universe } from './universe/universe';
export type { World, WorldOptions } from './world';
export { createWorld } from './world';

/**
 * Deprecations. To be removed in v0.7.0.
 */

import { createQuery } from './query/query';
/** @deprecated Use createQuery instead */
export const cacheQuery = createQuery;

import type { TraitInstance } from './trait/types';
/** @deprecated Use TraitInstance instead */
export type TraitData = TraitInstance;

/** @deprecated Will remove this internal type entirely */
export type { TraitInstance } from './trait/types';

/** @deprecated Will remove this internal type entirely */
export type { QueryInstance } from './query/types';
