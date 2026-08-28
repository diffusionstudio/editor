import type { SparseSet } from '../collections';
import type { Entity } from '../entity/types';
import type { RelationPair } from '../relation/types';
import type { AoSFactory } from '../storage';
import type {
  ExtractSchema,
  ExtractStore,
  IsTag,
  Trait,
  TraitInstance,
  TraitRecord,
} from '../trait/types';
import type { World } from '../world';
import { $modifier } from './modifier';
import { $parameters, $queryRef, $sortSource } from './symbols';

export type QueryModifier = (...components: Trait[]) => Modifier;
export type QueryParameter = Trait | RelationPair | ReturnType<QueryModifier>;
export type QuerySubscriber = (entity: Entity) => void;
export type QueryUnsubscriber = () => void;

export type QueryResultOptions = {
  changeDetection?: 'always' | 'auto' | 'never';
};

/** Direction accepted by `QueryResult.sortBy`. */
export type SortDirection = 'asc' | 'desc';

/** Trait values that define a natural order. */
type SortableValue = string | number | bigint | boolean;

/** Keys of a trait whose value can be used as a sort key. */
export type SortableKeys<T extends Trait> = {
  // The `[never]` guard keeps tag traits — whose record is `Record<string, never>` — from
  // reporting every string key as sortable, since `never extends SortableValue` is true.
  [K in keyof TraitRecord<T>]-?: [TraitRecord<T>[K]] extends [never]
    ? never
    : NonNullable<TraitRecord<T>[K]> extends SortableValue
      ? K
      : never;
}[keyof TraitRecord<T>];

/** Identity and invalidation hooks for the entity set feeding a `sortBy` cache. */
export type SortSource = {
  /** Stable identity of the entity set being sorted. */
  key: string;
  /** Monotonic version of the entity set; changes whenever entities enter or leave it. */
  version(): number;
  /**
   * Builds the cached result wrapper around the (mutable) ordered array. `cacheKey` is the
   * full identity of this ordering and becomes the source key of any further `sortBy` on
   * it, so chained sorts do not collide with a direct sort of the same query.
   */
  createResult(order: Entity[], cacheKey: string): QueryResult<any>;
};

/** A cached ordering produced by `QueryResult.sortBy`. */
export type SortCache = {
  /** Ordered entities backing `result`. Mutated in place so `result` stays stable. */
  order: Entity[];
  /** Result wrapper handed back on a cache hit. */
  result: QueryResult<any>;
  /** Source-set version this order was built from. */
  version: number;
  /** Set when a sort value changed on one of `members`. */
  dirty: boolean;
  /** Entities currently in the order, used to filter trait events. */
  members: Set<Entity>;
};

/** Context stashed on relation-only results so `sortBy` can find its cache. */
export type RelationSortContext = {
  world: World;
  relationTrait: Trait;
  target: Entity;
  sortKey?: string;
};

export type QueryResult<T extends QueryParameter[] = QueryParameter[]> = readonly Entity[] & {
  /** @internal Present on relation-only results to support `sortBy`. */
  [$sortSource]?: RelationSortContext;
  readEach: (
    callback: (state: InstancesFromParameters<T>, entity: Entity, index: number) => void
  ) => QueryResult<T>;
  updateEach: (
    callback: (state: InstancesFromParameters<T>, entity: Entity, index: number) => void,
    options?: QueryResultOptions
  ) => QueryResult<T>;
  useStores: (
    callback: (stores: StoresFromParameters<T>, entities: readonly Entity[]) => void
  ) => QueryResult<T>;
  select<U extends QueryParameter[]>(...params: U): QueryResult<U>;
  sort(callback?: (a: Entity, b: Entity) => number): QueryResult<T>;
  sortBy<S extends Trait>(
    trait: S,
    key: SortableKeys<S>,
    direction?: SortDirection
  ): QueryResult<T>;
};

type UnwrapModifierData<T> = T extends Modifier<infer C> ? C : never;

export type StoresFromParameters<T extends QueryParameter[]> = T extends [infer First, ...infer Rest]
  ? [
      ...(First extends Trait
        ? [ExtractStore<First>]
        : First extends Modifier
          ? StoresFromParameters<UnwrapModifierData<First>>
          : []),
      ...(Rest extends QueryParameter[] ? StoresFromParameters<Rest> : []),
    ]
  : [];

export type InstancesFromParameters<T extends QueryParameter[]> = T extends [
  infer First,
  ...infer Rest,
]
  ? [
      ...(First extends Trait
        ? IsTag<First> extends false
          ? ExtractSchema<First> extends AoSFactory
            ? [ReturnType<ExtractSchema<First>>]
            : [TraitRecord<First>]
          : []
        : First extends Modifier
          ? IsNotModifier<First> extends true
            ? []
            : InstancesFromParameters<UnwrapModifierData<First>>
          : []),
      ...(Rest extends QueryParameter[] ? InstancesFromParameters<Rest> : []),
    ]
  : [];

export type IsNotModifier<T> =
  T extends Modifier<Trait[], infer TType> ? (TType extends 'not' ? true : false) : false;

export type QueryHash = string;

export type Query<T extends QueryParameter[] = QueryParameter[]> = {
  readonly [$queryRef]: true;
  /** Public read-only ID for fast array lookups */
  readonly id: number;
  /** Hash string for deduplication */
  readonly hash: QueryHash;
  /** Query parameters for creating instances */
  readonly parameters: T;
  readonly [$parameters]: T;
};

export type ResolvedRelationFilter = RelationPair & {
  targetQueryRef?: Query<QueryParameter[]>;
  targetQueryMatches?: SparseSet;
};

export type Modifier<TTrait extends Trait[] = Trait[], TType extends string = string> = {
  [$modifier]: true;
  type: TType;
  id: number;
  traits: TTrait;
  traitIds: number[];
};

/** Parameter types that can be passed to Or modifier */
export type OrParameter = Trait | Modifier;

/** Or modifier that can contain both traits and nested modifiers */
export type OrModifier<T extends OrParameter[] = OrParameter[]> = Modifier<
  ExtractTraitsFromOrParams<T>,
  'or'
> & {
  modifiers: Modifier[];
};

/** Extract traits from Or parameters (filters out modifiers) */
type ExtractTraitsFromOrParams<T extends OrParameter[]> = T extends [infer First, ...infer Rest]
  ? First extends Trait
    ? Rest extends OrParameter[]
      ? [First, ...ExtractTraitsFromOrParams<Rest>]
      : [First]
    : Rest extends OrParameter[]
      ? ExtractTraitsFromOrParams<Rest>
      : []
  : [];

/**
 * Unified tracking group that supports both AND and OR logic.
 * Replaces the old separate tracking arrays and OrTrackingGroup.
 */
export type TrackingGroup = {
  /** Whether all traits must match (and) or any trait can match (or) */
  logic: 'and' | 'or';
  /** The type of tracking event */
  type: 'add' | 'remove' | 'change';
  /** Tracking modifier ID for snapshot/mask lookups */
  id: number;
  /** Bitmasks indexed by generationId */
  bitmasks: (number | undefined)[];
  /** Per-entity tracker state indexed by [generationId][entityId] */
  trackers: (number[] | undefined)[];
};

export type QueryInstance<T extends QueryParameter[] = QueryParameter[]> = {
  version: number;
  world: World;
  parameters: T;
  hash: QueryHash;
  traits: Trait[];
  /** Static trait instances for non-tracking query matching */
  traitInstances: {
    required: TraitInstance[];
    forbidden: TraitInstance[];
    or: TraitInstance[];
    all: TraitInstance[];
  };
  /** Static bitmasks for non-tracking query matching (indexed by generationId) */
  staticBitmasks: {
    required: number;
    forbidden: number;
    or: number;
  }[];
  /** Unified tracking groups with explicit AND/OR logic */
  trackingGroups: TrackingGroup[];
  generations: number[];
  entities: SparseSet;
  isTracking: boolean;
  hasChangedModifiers: boolean;
  changedTraits: Set<Trait>;
  toRemove: SparseSet;
  cleanup: QueryUnsubscriber[];
  addSubscriptions: Set<QuerySubscriber>;
  removeSubscriptions: Set<QuerySubscriber>;
  /** Relation pairs for target-specific queries */
  relationFilters?: ResolvedRelationFilter[];
  run: (world: World, params: QueryParameter[]) => QueryResult<T>;
  add: (entity: Entity) => void;
  remove: (world: World, entity: Entity) => void;
  check: (world: World, entity: Entity) => boolean;
  checkTracking: (
    world: World,
    entity: Entity,
    eventType: 'add' | 'remove' | 'change',
    generationId: number,
    bitflag: number
  ) => boolean;
  resetTrackingBitmasks: (eid: number) => void;
};

export type EventType = 'add' | 'remove' | 'change';
