import { $internal } from '../../common';
import type { Entity } from '../../entity/types';
import { getEntityId } from '../../entity/utils/pack-entity';
import type { World } from '../../world';
import type { EventType, QueryInstance } from '../types';

/**
 * Check if an entity matches a tracking query with event handling.
 *
 * PERF: This is a hot path - optimizations applied:
 * - Cache all property accesses at function start
 * - Use `| 0` instead of `|| 0` (bitwise coerces undefined to 0)
 * - Avoid optional chaining in inner loops
 * - Cache array references before mutation
 * - Early exits where possible
 */
export function checkQueryTracking(
  world: World,
  query: QueryInstance,
  entity: Entity,
  eventType: EventType,
  eventGenerationId: number,
  eventBitflag: number
): boolean {
  // Cache all property accesses upfront
  const staticBitmasks = query.staticBitmasks;
  const trackingGroups = query.trackingGroups;
  const generations = query.generations;
  const traitInstancesAll = query.traitInstances.all;
  const entityMasks = world[$internal].entityMasks;
  const eid = getEntityId(entity);

  const generationsLen = generations.length;
  const trackingGroupsLen = trackingGroups.length;

  // Early exit: no traits to check
  if (traitInstancesAll.length === 0) return false;

  // FORK: `Or` is a query-wide constraint, but bitmasks are split per generation.
  // Accumulate across generations instead of rejecting on the first generation
  // whose Or mask does not match. See patches/koota+0.6.6.patch (now folded in).
  let staticHasOr = false;
  let staticOrMatched = false;

  // 1. Check static constraints (required/forbidden/or)
  for (let i = 0; i < generationsLen; i++) {
    const generationId = generations[i];
    const bitmask = staticBitmasks[i];
    if (!bitmask) continue;

    const required = bitmask.required;
    const forbidden = bitmask.forbidden;
    const or = bitmask.or;

    // PERF: Direct access + bitwise OR coerces undefined to 0
    const genMasks = entityMasks[generationId];
    const entityMask = genMasks ? genMasks[eid] | 0 : 0;

    // Check forbidden traits
    if (forbidden && (entityMask & forbidden) !== 0) return false;

    // Check required traits
    if (required && (entityMask & required) !== required) return false;

    // Check Or traits
    if (or !== 0) {
      staticHasOr = true;
      if ((entityMask & or) !== 0) staticOrMatched = true;
    }
  }

  if (staticHasOr && !staticOrMatched) return false;

  // 2. Process tracking groups - update trackers and check cross-event invalidation
  // Also track OR group state to avoid second loop when possible
  let hasOrGroup = false;
  let anyOrMatched = false;

  for (let i = 0; i < trackingGroupsLen; i++) {
    const group = trackingGroups[i];
    const groupType = group.type;
    const groupLogic = group.logic;
    const groupBitmasks = group.bitmasks;
    const groupBitmask = groupBitmasks[eventGenerationId];

    // Check if this event affects this group's traits
    if (groupBitmask && groupBitmask & eventBitflag) {
      // Cross-event invalidation:
      // - Remove event invalidates Added/Changed tracking
      // - Add event invalidates Removed/Changed tracking
      if (eventType === 'remove') {
        if (groupType === 'add' || groupType === 'change') return false;
      } else if (eventType === 'add') {
        if (groupType === 'remove' || groupType === 'change') return false;
      }

      // Update tracker if event type matches group type
      if (groupType === eventType) {
        // For change events, verify entity still has the trait
        if (eventType === 'change') {
          const genMasks = entityMasks[eventGenerationId];
          const entityMask = genMasks ? genMasks[eid] | 0 : 0;
          if (!(entityMask & eventBitflag)) return false;
        }

        // PERF: Cache tracker array reference before mutation
        const groupTrackers = group.trackers;
        let trackerArr = groupTrackers[eventGenerationId];
        if (!trackerArr) {
          trackerArr = [];
          groupTrackers[eventGenerationId] = trackerArr;
        }
        trackerArr[eid] = trackerArr[eid] | 0 | eventBitflag;
      }
    }

    // 3. Verify tracking group satisfaction (merged into same loop)
    if (groupLogic === 'or') {
      hasOrGroup = true;
      if (!anyOrMatched) {
        // Check if any trait in OR group has been tracked
        const groupTrackers = group.trackers;
        const bitmaskLen = groupBitmasks.length;
        for (let genId = 0; genId < bitmaskLen; genId++) {
          const mask = groupBitmasks[genId];
          if (!mask) continue;
          const trackerArr = groupTrackers[genId];
          const tracker = trackerArr ? trackerArr[eid] | 0 : 0;
          if (tracker & mask) {
            anyOrMatched = true;
            break;
          }
        }
      }
    } else {
      // AND group: all traits must be tracked
      const groupTrackers = group.trackers;
      const bitmaskLen = groupBitmasks.length;
      for (let genId = 0; genId < bitmaskLen; genId++) {
        const mask = groupBitmasks[genId];
        if (!mask) continue;
        const trackerArr = groupTrackers[genId];
        const tracker = trackerArr ? trackerArr[eid] | 0 : 0;
        if ((tracker & mask) !== mask) {
          return false;
        }
      }
    }
  }

  // If we have OR groups, at least one must match
  if (hasOrGroup && !anyOrMatched) {
    return false;
  }

  return true;
}
