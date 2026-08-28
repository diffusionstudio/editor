import type { Trait, TraitInstance } from './types';

export type TraitInstanceArray = (TraitInstance | undefined)[];

/**
 * Get TraitInstance by trait ID
 */
export /* @inline @pure */ function getTraitInstance(
  traitData: TraitInstanceArray,
  trait: Trait
): TraitInstance | undefined {
  return traitData[trait.id];
}

/**
 * Set TraitInstance by trait ID
 */
export /* @inline */ function setTraitInstance(
  traitData: TraitInstanceArray,
  trait: Trait,
  data: TraitInstance
): void {
  const traitId = trait.id;
  // Ensure array is large enough
  if (traitId >= traitData.length) {
    traitData.length = traitId + 1;
  }
  traitData[traitId] = data;
}

/**
 * Check if trait is registered
 */
export /* @inline @pure */ function hasTraitInstance(
  traitData: TraitInstanceArray,
  trait: Trait
): boolean {
  const traitId = trait.id;
  return traitId < traitData.length && traitData[traitId] !== undefined;
}

/**
 * Clear all trait data
 */
export /* @inline */ function clearTraitInstance(traitData: TraitInstanceArray): void {
  traitData.length = 0;
}
