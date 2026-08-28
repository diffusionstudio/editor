import { $internal } from '../common';
import type { World } from '../world';
import type { Actions, ActionsInitializer, ActionRecord } from './types';

let actionsId = 0;

export function createActions<T extends ActionRecord>(
  initializer: ActionsInitializer<T>
): Actions<T> {
  const id = actionsId++;

  const actions = Object.assign(
    (world: World): T => {
      const ctx = world[$internal];

      // Try array lookup first (faster)
      let instance = ctx.actionInstances[id];

      if (!instance) {
        // Create and cache actions instance
        instance = initializer(world);

        // Ensure array is large enough
        if (id >= ctx.actionInstances.length) {
          ctx.actionInstances.length = id + 1;
        }
        ctx.actionInstances[id] = instance;
      }

      return instance as T;
    },
    {
      initializer,
    }
  ) as Actions<T>;

  // Add public read-only id property
  Object.defineProperty(actions, 'id', {
    value: id,
    writable: false,
    enumerable: true,
    configurable: false,
  });

  return actions;
}
