import type { Relation, RelationPair } from '../relation/types';
import type {
  ConfigurableTrait,
  ExtractSchema,
  SetTraitCallback,
  Trait,
  TraitRecord,
  TraitValue,
} from '../trait/types';

export type Entity = number & {
  add: (...traits: ConfigurableTrait[]) => void;
  remove: (...traits: (Trait | RelationPair)[]) => void;
  has: (trait: Trait | RelationPair) => boolean;
  destroy: () => void;
  changed: (trait: Trait) => void;
  set: <T extends Trait | RelationPair>(
    trait: T,
    value: TraitValue<ExtractSchema<T>> | SetTraitCallback<T>,
    flagChanged?: boolean
  ) => void;
  get: <T extends Trait | RelationPair>(trait: T) => TraitRecord<ExtractSchema<T>> | undefined;
  targetFor: <T extends Trait>(relation: Relation<T>) => Entity | undefined;
  targetsFor: <T extends Trait>(relation: Relation<T>) => Entity[];
  id: () => number;
  generation: () => number;
  isAlive: () => boolean;
};
