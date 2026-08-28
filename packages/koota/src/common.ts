export const $internal = Symbol.for('koota.internal');

/**
 * Type utility for symbol-branded runtime type checks.
 * Allows accessing a symbol property while maintaining type safety.
 */
export type Brand<S extends symbol> = { readonly [K in S]?: true };
