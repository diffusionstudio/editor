import type { Schema, StoreType } from './types';

/**
 * Get default values from a schema.
 * Returns null for tags (empty schemas) or if no defaults exist.
 */
/* @inline @pure */ export function getSchemaDefaults(
  schema: Record<string, any> | (() => unknown),
  type: StoreType
): Record<string, any> | null {
  if (type === 'aos') {
    return typeof schema === 'function' ? (schema() as Record<string, any>) : null;
  }

  if (!schema || typeof schema === 'function' || Object.keys(schema).length === 0) return null;

  const defaults: Record<string, any> = {};
  for (const key in schema) {
    if (typeof schema[key] === 'function') {
      defaults[key] = schema[key]();
    } else {
      defaults[key] = schema[key];
    }
  }
  return defaults;
}

export /* @inline @pure */ function validateSchema(schema: Schema) {
  for (const key in schema) {
    const value = schema[key as keyof Schema];
    if (value !== null && typeof value === 'object') {
      const kind = Array.isArray(value) ? 'array' : 'object';
      throw new Error(`Koota: ${key} is an ${kind}, which is not supported in traits.`);
    }
  }
}
