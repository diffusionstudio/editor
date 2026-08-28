export class Deque<T> {
  #removed: T[] = [];
  #removedOut: T[] = [];

  dequeue(): T {
    if (this.#removedOut.length === 0) {
      while (this.#removed.length > 0) {
        this.#removedOut.push(this.#removed.pop()!);
      }
    }

    if (this.#removedOut.length === 0) {
      throw new Error('Queue is empty');
    }

    return this.#removedOut.pop()!;
  }

  enqueue(...items: T[]): void {
    this.#removed.push(...items);
  }

  get length(): number {
    return this.#removed.length + this.#removedOut.length;
  }

  clear(): void {
    this.#removed.length = 0;
    this.#removedOut.length = 0;
  }
}
