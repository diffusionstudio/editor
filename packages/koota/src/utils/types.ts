export type Constructor<T = any> = new (...args: any[]) => T;
export type IsEmpty<T> = T extends Record<string, never> ? true : false;
