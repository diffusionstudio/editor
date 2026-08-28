import type { Trait } from '../../trait/types';
import type { Modifier, OrModifier, OrParameter } from '../types';
import { $modifier, createModifier } from '../modifier';

export const Or = <T extends OrParameter[]>(...params: T): OrModifier<T> => {
  // Separate traits from nested modifiers
  const traits: Trait[] = [];
  const modifiers: Modifier[] = [];

  for (const param of params) {
    if ((param as Modifier)[$modifier]) {
      modifiers.push(param as Modifier);
    } else {
      traits.push(param as Trait);
    }
  }

  const modifier = createModifier('or', 2, traits) as OrModifier<T>;
  modifier.modifiers = modifiers;

  return modifier;
};
