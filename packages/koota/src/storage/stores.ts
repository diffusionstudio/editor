import type { Schema } from './types';
import type { Store } from './types';

export function createStore<T extends Schema>(schema: T): Store<T>;
export function createStore(schema: Schema): unknown {
  if (typeof schema === 'function') {
    return [];
  } else {
    const store: Record<string, unknown[]> = {};

    for (const key in schema) {
      store[key] = [];
    }

    return store;
  }
}
