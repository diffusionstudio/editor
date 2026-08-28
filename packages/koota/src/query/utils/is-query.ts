import type { Brand } from '../../common';
import type { Query } from '../types';
import { $queryRef } from '../symbols';

/**
 * Check if a value is a Query
 */
export /* @inline @pure */ function isQuery(value: unknown): value is Query<any> {
  return (value as Brand<typeof $queryRef> | null | undefined)?.[$queryRef] as unknown as boolean;
}
