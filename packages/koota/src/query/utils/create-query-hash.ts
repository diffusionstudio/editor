import { $internal } from '../../common';
import type { Relation } from '../../relation/types';
import { isRelationPair } from '../../relation/utils/is-relation';
import type { Trait } from '../../trait/types';
import { isModifier } from '../modifier';
import { isQuery } from './is-query';
import type { QueryHash, QueryParameter } from '../types';

const MODIFIER_FACTOR = 100000;
const RELATION_FACTOR = 10000000;
const RELATION_OFFSET = 5000000;
// Offset for target-query relation pairs so they don't collide with concrete target encodings.
const RELATION_QUERY_OFFSET = 9000000;

// Reusable buffer — avoids allocation per call.
const sortBuf = new Float64Array(1024);

// Maps a sub-query hash string to a stable numeric id for encoding in the Float64Array.
let nextQueryId = 1;
const queryHashToId = new Map<string, number>();

function queryHashNumericId(hash: string): number {
  let id = queryHashToId.get(hash);
  if (id === undefined) {
    id = nextQueryId++;
    queryHashToId.set(hash, id);
  }
  return id;
}

export const createQueryHash = (parameters: QueryParameter[]): QueryHash => {
  let cursor = 0;

  for (let i = 0; i < parameters.length; i++) {
    const param = parameters[i];

    if (isRelationPair(param)) {
      const relationId = (param.relation as Relation<Trait>)[$internal].trait.id;

      if (param.targetQuery) {
        const subHash = isQuery(param.targetQuery)
          ? param.targetQuery.hash
          : createQueryHash([...param.targetQuery]);
        sortBuf[cursor++] =
          relationId * RELATION_FACTOR + queryHashNumericId(subHash) + RELATION_QUERY_OFFSET;
        continue;
      }

      const target = param.target;
      const targetId = typeof target === 'number' ? target : -1;
      sortBuf[cursor++] = relationId * RELATION_FACTOR + targetId + RELATION_OFFSET;
      continue;
    }

    if (isModifier(param)) {
      for (let j = 0; j < param.traitIds.length; j++) {
        sortBuf[cursor++] = param.id * MODIFIER_FACTOR + param.traitIds[j];
      }
      continue;
    }

    sortBuf[cursor++] = (param as Trait).id;
  }

  const filled = sortBuf.subarray(0, cursor);
  filled.sort();
  return filled.join(',');
};
