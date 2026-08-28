import type { Entity } from '../../entity/types';
import { hasRelationPair, hasRelationTargetInSet } from '../../relation/relation';
import type { World } from '../../world';
import type { QueryInstance } from '../types';
import { checkQuery } from './check-query';

/**
 * Check if an entity matches a query with relation filters.
 * Uses hybrid bitmask strategy: trait bitmasks first (fast), then relation checks.
 */
export function checkQueryWithRelations(world: World, query: QueryInstance, entity: Entity): boolean {
  // First check trait bitmasks (fast)
  if (!checkQuery(world, query, entity)) return false;

  // Then check relation pairs if any
  if (query.relationFilters && query.relationFilters.length > 0) {
    for (const pair of query.relationFilters) {
      if (pair.targetQueryMatches) {
        if (!hasRelationTargetInSet(world, pair.relation, entity, pair.targetQueryMatches)) {
          return false;
        }
        continue;
      }

      if (!hasRelationPair(world, entity, pair)) {
        return false;
      }
    }
  }

  return true;
}
