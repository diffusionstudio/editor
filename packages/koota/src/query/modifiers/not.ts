import type { Trait } from '../../trait/types';
import type { Modifier } from '../types';
import { createModifier } from '../modifier';

export const Not = <T extends Trait[] = Trait[]>(...traits: T): Modifier<T, 'not'> => {
  return createModifier('not', 1, traits);
};
