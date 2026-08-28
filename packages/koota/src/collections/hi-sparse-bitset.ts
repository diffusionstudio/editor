/**
 * Hierarchical Sparse BitSet
 * Credit goes to @tower120 for https://github.com/tower120/hi_sparse_bitset
 *
 * This is just a typescript rewrite of that library.
 */

/** Count trailing zeros — position of lowest set bit. */
/* @inline @pure */ export function ctz32(v: number): number {
  if (v === 0) return 32;
  return 31 - Math.clz32(v & -v);
}

/** Population count — number of set bits in a 32-bit integer. */
/* @inline @pure */ function popcount32(v: number): number {
  const a = v - ((v >>> 1) & 0x55555555);
  const b = (a & 0x33333333) + ((a >>> 2) & 0x33333333);
  return (((b + (b >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Static empty block for branchless reads. */
const EMPTY_BLOCK = new Uint32Array(32);

export class HiSparseBitSet {
  /** L0 summary: bit i set means l1Summary[i] has data. */
  l0: number = 0;

  /** L1 summary: l1Summary[l0i] bit j set means l2 block (l0i*32 + j) has data. */
  l1Summary: Uint32Array = new Uint32Array(32);

  /** L2 data blocks. l2Blocks[l1i] is a 32-element Uint32Array (pre-allocated to 32 null slots). */
  l2Blocks: (Uint32Array | null)[] = new Array<Uint32Array | null>(32).fill(null);

  private _size: number = 0;

  get size(): number {
    return this._size;
  }

  /** Insert an entity index into the set. O(1) amortized. */
  insert(index: number): void {
    const l0i = index >>> 15;
    const l1i = (index >>> 10) & 31;
    const blockIdx = l0i === 0 ? l1i : (l0i << 5) | l1i;

    // Allocate L2 block if needed
    let block = this.l2Blocks[blockIdx];
    if (block === null || block === undefined) {
      block = new Uint32Array(32);
      this.l2Blocks[blockIdx] = block;
    }

    const l2i = (index >>> 5) & 31;
    const mask = 1 << (index & 31);
    const word = block[l2i];

    if ((word & mask) === 0) {
      block[l2i] = word | mask;
      this.l1Summary[l0i] |= 1 << l1i;
      this.l0 |= 1 << l0i;
      this._size++;
    }
  }

  /** Remove an entity index from the set. O(1). */
  remove(index: number): void {
    const l0i = index >>> 15;
    const l1i = (index >>> 10) & 31;
    const blockIdx = l0i === 0 ? l1i : (l0i << 5) | l1i;
    const block = this.l2Blocks[blockIdx];
    if (block === null || block === undefined) return;

    const l2i = (index >>> 5) & 31;
    const mask = 1 << (index & 31);
    const word = block[l2i];

    if ((word & mask) !== 0) {
      block[l2i] = word & ~mask;
      this._size--;

      // Check if entire L2 block is now empty
      if (block[l2i] === 0) {
        // Scan the block to see if any words remain
        let blockEmpty = true;
        for (let i = 0; i < 32; i++) {
          if (block[i] !== 0) {
            blockEmpty = false;
            break;
          }
        }

        if (blockEmpty) {
          this.l1Summary[l0i] &= ~(1 << l1i);

          // Check if entire L1 group is now empty
          if (this.l1Summary[l0i] === 0) {
            this.l0 &= ~(1 << l0i);
          }
        }
      }
    }
  }

  /** Test membership. O(1). */
  has(index: number): boolean {
    const l0i = index >>> 15;
    const blockIdx = l0i === 0 ? (index >>> 10) & 31 : (l0i << 5) | ((index >>> 10) & 31);
    const block = this.l2Blocks[blockIdx];
    if (block === null || block === undefined) return false;
    return (block[(index >>> 5) & 31] & (1 << (index & 31))) !== 0;
  }

  /** Clear all entries. */
  clear(): void {
    this.l0 = 0;
    this.l1Summary.fill(0);
    for (let i = 0; i < this.l2Blocks.length; i++) {
      const block = this.l2Blocks[i];
      if (block !== null && block !== undefined) block.fill(0);
    }
    this._size = 0;
  }

  /** Get L2 data block for branchless reads. Returns EMPTY_BLOCK if not allocated. */
  getBlock(blockIdx: number): Uint32Array {
    return this.l2Blocks[blockIdx] ?? EMPTY_BLOCK;
  }

  /** Create a deep copy of this bitset. */
  clone(): HiSparseBitSet {
    const copy = new HiSparseBitSet();
    copy.l0 = this.l0;
    copy.l1Summary = new Uint32Array(this.l1Summary);
    copy._size = this._size;
    for (let i = 0; i < this.l2Blocks.length; i++) {
      const block = this.l2Blocks[i];
      if (block !== null && block !== undefined) {
        copy.l2Blocks[i] = new Uint32Array(block);
      }
    }
    return copy;
  }

  /** Iterate all set indices in sorted order via callback. Zero allocation. */
  forEach(callback: (index: number) => void): void {
    let l0Bits = this.l0;
    while (l0Bits !== 0) {
      const l0i = ctz32(l0Bits);
      l0Bits &= l0Bits - 1;

      let l1Bits = this.l1Summary[l0i];
      while (l1Bits !== 0) {
        const l1i = ctz32(l1Bits);
        l1Bits &= l1Bits - 1;

        const blockIdx = (l0i << 5) | l1i;
        const block = this.l2Blocks[blockIdx]!;

        for (let l2i = 0; l2i < 32; l2i++) {
          let word = block[l2i];
          if (word === 0) continue;

          const base = (l0i << 15) | (l1i << 10) | (l2i << 5);
          while (word !== 0) {
            const bit = ctz32(word);
            word &= word - 1;
            callback(base | bit);
          }
        }
      }
    }
  }

  /** Iterate all set bits in ascending order AND clear them. After drain the bitset is empty. */
  drain(callback: (index: number) => void): void {
    let l0Bits = this.l0;
    if (l0Bits === 0) return;

    while (l0Bits !== 0) {
      const l0i = ctz32(l0Bits);
      l0Bits &= l0Bits - 1;

      let l1Bits = this.l1Summary[l0i];
      while (l1Bits !== 0) {
        const l1i = ctz32(l1Bits);
        l1Bits &= l1Bits - 1;

        const blockIdx = (l0i << 5) | l1i;
        const block = this.l2Blocks[blockIdx]!;

        for (let l2i = 0; l2i < 32; l2i++) {
          let word = block[l2i];
          if (word === 0) continue;

          const base = (l0i << 15) | (l1i << 10) | (l2i << 5);
          while (word !== 0) {
            const bit = ctz32(word);
            word &= word - 1;
            callback(base | bit);
          }
          block[l2i] = 0;
        }
      }
      this.l1Summary[l0i] = 0;
    }

    this.l0 = 0;
    this._size = 0;
  }

  /**
   * Set a contiguous range [start, end) using word-level ops.
   * A 100-entity subtree = ~3 word fills + 2 partial ORs vs 100 individual insert() calls.
   */
  setRange(start: number, end: number): void {
    if (start >= end) return;

    for (let idx = start; idx < end;) {
      const l0i = idx >>> 15;
      const l1i = (idx >>> 10) & 31;
      const l2i = (idx >>> 5) & 31;
      const bit = idx & 31;

      const blockIdx = (l0i << 5) | l1i;

      let block = this.l2Blocks[blockIdx];
      if (block === null || block === undefined) {
        block = new Uint32Array(32);
        this.l2Blocks[blockIdx] = block;
      }

      // How many indices remain in this L2 word?
      const wordEnd = Math.min(end, (idx & ~31) + 32);
      const count = wordEnd - idx;

      if (bit === 0 && count >= 32) {
        // Full word fill
        const prev = block[l2i];
        if (prev !== ~0 >>> 0) {
          const added = 32 - popcount32(prev);
          block[l2i] = ~0 >>> 0;
          this._size += added;
        }
      } else {
        // Partial word: bits [bit, bit + count - 1]
        const endBit = bit + count - 1;
        const mask = ((2 << endBit) - 1) & ~((1 << bit) - 1);
        const prev = block[l2i];
        const newWord = prev | mask;
        if (newWord !== prev) {
          this._size += popcount32(newWord) - popcount32(prev);
          block[l2i] = newWord;
        }
      }

      this.l1Summary[l0i] |= 1 << l1i;
      this.l0 |= 1 << l0i;

      idx = wordEnd;
    }
  }
}

/**
 * High-performance N-way intersection iteration via callback.
 * Prunes at each hierarchy level — only visits entity IDs present in ALL sets.
 * Zero allocation during iteration.
 *
 * Returns the number of entities visited.
 */
export function forEachIntersection(
  sets: HiSparseBitSet[],
  callback: (entityId: number) => void
): number {
  const n = sets.length;
  if (n === 0) return 0;

  let count = 0;

  // Pre-extract l2Blocks arrays to avoid repeated property access
  const allL2Blocks: (Uint32Array | null)[][] = new Array(n);
  for (let i = 0; i < n; i++) allL2Blocks[i] = sets[i].l2Blocks;

  // AND all L0 masks
  let l0Combined = ~0 >>> 0;
  for (let i = 0; i < n; i++) l0Combined &= sets[i].l0;

  while (l0Combined !== 0) {
    const l0i = ctz32(l0Combined);
    l0Combined &= l0Combined - 1;

    // AND all L1 summaries for this L0 slot
    let l1Combined = ~0 >>> 0;
    for (let i = 0; i < n; i++) l1Combined &= sets[i].l1Summary[l0i];

    while (l1Combined !== 0) {
      const l1i = ctz32(l1Combined);
      l1Combined &= l1Combined - 1;

      const blockIdx = (l0i << 5) | l1i;

      // Pre-resolve all blocks for this blockIdx — one branch per set, not 32×n
      let skipBlock = false;
      for (let i = 0; i < n; i++) {
        const blk = allL2Blocks[i][blockIdx];
        if (blk === null || blk === undefined) {
          skipBlock = true;
          break;
        }
      }
      if (skipBlock) continue;

      // AND all L2 data words — blocks guaranteed non-null
      for (let l2i = 0; l2i < 32; l2i++) {
        let word = ~0 >>> 0;
        for (let i = 0; i < n; i++) {
          word &= allL2Blocks[i][blockIdx]![l2i];
          if (word === 0) break;
        }

        if (word === 0) continue;

        const base = (l0i << 15) | (l1i << 10) | (l2i << 5);
        while (word !== 0) {
          const bit = ctz32(word);
          word &= word - 1;
          callback(base | bit);
          count++;
        }
      }
    }
  }

  return count;
}

/**
 * N-way intersection with forbidden set exclusion.
 * The full ECS query pattern: required(A, B, C) AND NOT(D, E).
 *
 * Returns the number of entities visited.
 */
export function forEachQuery(
  required: HiSparseBitSet[],
  forbidden: HiSparseBitSet[],
  callback: (entityId: number) => void
): number {
  const nReq = required.length;
  const nForb = forbidden.length;
  if (nReq === 0) return 0;

  let count = 0;

  // Pre-extract l2Blocks arrays to avoid repeated property access
  const reqL2: (Uint32Array | null)[][] = new Array(nReq);
  for (let i = 0; i < nReq; i++) reqL2[i] = required[i].l2Blocks;
  const forbL2: (Uint32Array | null)[][] = new Array(nForb);
  for (let i = 0; i < nForb; i++) forbL2[i] = forbidden[i].l2Blocks;

  // AND all required L0 masks
  let l0Combined = ~0 >>> 0;
  for (let i = 0; i < nReq; i++) l0Combined &= required[i].l0;

  while (l0Combined !== 0) {
    const l0i = ctz32(l0Combined);
    l0Combined &= l0Combined - 1;

    // AND all required L1 summaries
    let l1Combined = ~0 >>> 0;
    for (let i = 0; i < nReq; i++) l1Combined &= required[i].l1Summary[l0i];

    while (l1Combined !== 0) {
      const l1i = ctz32(l1Combined);
      l1Combined &= l1Combined - 1;

      const blockIdx = (l0i << 5) | l1i;

      // Pre-resolve required blocks — if any is null, skip entire block
      let skipBlock = false;
      for (let i = 0; i < nReq; i++) {
        const blk = reqL2[i][blockIdx];
        if (blk === null || blk === undefined) {
          skipBlock = true;
          break;
        }
      }
      if (skipBlock) continue;

      for (let l2i = 0; l2i < 32; l2i++) {
        // AND required data words — blocks guaranteed non-null
        let word = ~0 >>> 0;
        for (let i = 0; i < nReq; i++) {
          word &= reqL2[i][blockIdx]![l2i];
          if (word === 0) break;
        }

        // ANDNOT forbidden data words (null block = 0, no effect)
        if (word !== 0) {
          for (let i = 0; i < nForb; i++) {
            const fBlock = forbL2[i][blockIdx];
            if (fBlock !== null && fBlock !== undefined) {
              word &= ~fBlock[l2i];
              if (word === 0) break;
            }
          }
        }

        if (word === 0) continue;

        const base = (l0i << 15) | (l1i << 10) | (l2i << 5);
        while (word !== 0) {
          const bit = ctz32(word);
          word &= word - 1;
          callback(base | bit);
          count++;
        }
      }
    }
  }

  return count;
}

/**
 * Collect intersection results into an array.
 */
export function collectIntersection(sets: HiSparseBitSet[]): number[] {
  const result: number[] = [];
  forEachIntersection(sets, (eid) => result.push(eid));
  return result;
}

/**
 * Collect query results (required + forbidden) into an array.
 */
export function collectQuery(required: HiSparseBitSet[], forbidden: HiSparseBitSet[]): number[] {
  const result: number[] = [];
  forEachQuery(required, forbidden, (eid) => result.push(eid));
  return result;
}
