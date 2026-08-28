export class SparseSet {
  _dense: number[] = [];
  _sparse: number[] = [];
  _cursor: number = 0;
  _denseRaw: { array: number[]; length: number } = { array: this._dense, length: 0 };

  has(val: number): boolean {
    const index = this._sparse[val];
    return index < this._cursor && this._dense[index] === val;
  }

  add(val: number): void {
    if (this.has(val)) return;
    this._sparse[val] = this._cursor;
    this._dense[this._cursor++] = val;
  }

  remove(val: number): void {
    if (!this.has(val)) return;
    const index = this._sparse[val];
    this._cursor--;
    const swapped = this._dense[this._cursor];
    if (swapped !== val) {
      this._dense[index] = swapped;
      this._sparse[swapped] = index;
    }
  }

  clear(): void {
    // Clear the sparse array entries for all active values
    for (let i = 0; i < this._cursor; i++) {
      this._sparse[this._dense[i]] = 0;
    }
    this._cursor = 0;
  }

  sort(): void {
    this._dense.sort((a, b) => a - b);
    for (let i = 0; i < this._dense.length; i++) {
      this._sparse[this._dense[i]] = i;
    }
  }

  getIndex(val: number): number {
    return this._sparse[val];
  }

  get dense(): number[] {
    return this._dense.slice(0, this._cursor);
  }

  get denseRaw(): { array: number[]; length: number } {
    this._denseRaw.length = this._cursor;
    return this._denseRaw;
  }

  get rawDense(): readonly number[] {
    return this._dense;
  }

  get length(): number {
    return this._cursor;
  }

  get sparse(): number[] {
    return this._sparse;
  }
}
