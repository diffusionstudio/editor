import type { Brand } from '../../common';
import type { Trait } from '../../trait/types';
import type { Relation, RelationPair } from '../types';
import { $relation, $relationPair } from '../symbols';

/**
 * Check if a value is a Relation
 */
export /* @inline @pure */ function isRelation(value: unknown): value is Relation<Trait> {
  return (value as Brand<typeof $relation> | null | undefined)?.[$relation] as unknown as boolean;
}

/**
 * Check if a value is a RelationPair
 */
export /* @inline @pure */ function isRelationPair(value: unknown): value is RelationPair {
  return (value as Brand<typeof $relationPair> | null | undefined)?.[
    $relationPair
  ] as unknown as boolean;
}
