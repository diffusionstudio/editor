import type { ActionInstance } from '../actions/types';
import type { $internal } from '../common';
import type { Entity } from '../entity/types';
import type { createEntityIndex } from '../entity/utils/entity-index';
import type {
  Query,
  QueryInstance,
  QueryParameter,
  QueryResult,
  QueryUnsubscriber,
  SortCache,
} from '../query/types';
import type { Relation, RelationPair } from '../relation/types';
import type {
  ConfigurableTrait,
  ExtractSchema,
  SetTraitCallback,
  Trait,
  TraitInstance,
  TraitRecord,
  TraitValue,
} from '../trait/types';

export type WorldOptions = {
  traits?: ConfigurableTrait[];
  lazy?: boolean;
};

export type WorldInternal = {
  entityIndex: ReturnType<typeof createEntityIndex>;
  entityMasks: number[][];
  entityTraits: Map<number, Set<Trait>>;
  bitflag: number;
  traitInstances: (TraitInstance | undefined)[];
  relations: Set<Relation<Trait>>;
  queriesHashMap: Map<string, QueryInstance>;
  queryInstances: (QueryInstance | undefined)[];
  actionInstances: (ActionInstance | undefined)[];
  notQueries: Set<QueryInstance>;
  dirtyQueries: Set<QueryInstance>;
  dirtyMasks: Map<number, number[][]>;
  trackingSnapshots: Map<number, number[][]>;
  changedMasks: Map<number, number[][]>;
  worldEntity: Entity;
  trackedTraits: Set<Trait>;
  resetSubscriptions: Set<(world: World) => void>;
  sortCaches: Map<string, SortCache>;
};

export type World = {
  readonly id: number;
  readonly isInitialized: boolean;
  readonly entities: Entity[];
  readonly traits: Set<Trait>;
  [$internal]: WorldInternal;
  init(...traits: ConfigurableTrait[]): void;
  spawn(...traits: ConfigurableTrait[]): Entity;
  has(entity: Entity): boolean;
  has(trait: Trait): boolean;
  has(target: Entity | Trait): boolean;
  add(...traits: ConfigurableTrait[]): void;
  remove(...traits: Trait[]): void;
  get<T extends Trait>(trait: T): TraitRecord<ExtractSchema<T>> | undefined;
  set<T extends Trait>(trait: T, value: TraitValue<ExtractSchema<T>> | SetTraitCallback<T>): void;
  destroy(): void;
  reset(): void;
  query<T extends QueryParameter[]>(key: Query<T>): QueryResult<T>;
  query<T extends QueryParameter[]>(...parameters: T): QueryResult<T>;
  queryFirst<T extends QueryParameter[]>(key: Query<T>): Entity | undefined;
  queryFirst<T extends QueryParameter[]>(...parameters: T): Entity | undefined;
  onQueryAdd<T extends QueryParameter[]>(
    key: Query<T>,
    callback: (entity: Entity) => void
  ): QueryUnsubscriber;
  onQueryAdd<T extends QueryParameter[]>(
    parameters: T,
    callback: (entity: Entity) => void
  ): QueryUnsubscriber;
  onQueryRemove<T extends QueryParameter[]>(
    key: Query<T>,
    callback: (entity: Entity) => void
  ): QueryUnsubscriber;
  onQueryRemove<T extends QueryParameter[]>(
    parameters: T,
    callback: (entity: Entity) => void
  ): QueryUnsubscriber;
  onAdd<T extends Trait>(trait: T, callback: (entity: Entity) => void): QueryUnsubscriber;
  onAdd<T extends Trait>(
    relation: Relation<T>,
    callback: (entity: Entity, target: Entity) => void
  ): QueryUnsubscriber;
  onAdd<T extends Trait>(
    pair: RelationPair<T>,
    callback: (entity: Entity, target: Entity) => void
  ): QueryUnsubscriber;
  onAdd(
    input: Trait | Relation<Trait> | RelationPair,
    callback: (entity: Entity, target?: Entity) => void
  ): QueryUnsubscriber;
  onRemove<T extends Trait>(trait: T, callback: (entity: Entity) => void): QueryUnsubscriber;
  onRemove<T extends Trait>(
    relation: Relation<T>,
    callback: (entity: Entity, target: Entity) => void
  ): QueryUnsubscriber;
  onRemove<T extends Trait>(
    pair: RelationPair<T>,
    callback: (entity: Entity, target: Entity) => void
  ): QueryUnsubscriber;
  onRemove(
    input: Trait | Relation<Trait> | RelationPair,
    callback: (entity: Entity, target?: Entity) => void
  ): QueryUnsubscriber;
  onChange<T extends Trait>(trait: T, callback: (entity: Entity) => void): QueryUnsubscriber;
  onChange<T extends Trait>(
    relation: Relation<T>,
    callback: (entity: Entity, target: Entity) => void
  ): QueryUnsubscriber;
  onChange<T extends Trait>(
    pair: RelationPair<T>,
    callback: (entity: Entity, target: Entity) => void
  ): QueryUnsubscriber;
  onChange(
    input: Trait | Relation<Trait> | RelationPair,
    callback: (entity: Entity, target?: Entity) => void
  ): QueryUnsubscriber;
};
