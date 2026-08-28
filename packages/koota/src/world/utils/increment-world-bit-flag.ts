import { $internal } from '../../common';
import type { World } from '../types';

// These should be Float32Arrays since we are using bitwise operations.
// They are native Arrays to avoid overlow issues due to recycling.
export /* @inline */ function incrementWorldBitflag(world: World) {
  const ctx = world[$internal];

  ctx.bitflag *= 2;

  if (ctx.bitflag >= 2 ** 31) {
    ctx.bitflag = 1;
    ctx.entityMasks.push([]);
  }
}
