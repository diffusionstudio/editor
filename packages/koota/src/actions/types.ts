import type { World } from '../world';

export type ActionRecord = Record<string, (...args: any[]) => void>;
export type ActionsInitializer<T extends ActionRecord> = (world: World) => T;
export type Actions<T extends ActionRecord> = {
  /** Public read-only ID for fast array lookups */
  readonly id: number;
  /** Initializer function */
  readonly initializer: ActionsInitializer<T>;
} & ((world: World) => T);

export type ActionInstance = ActionRecord;
