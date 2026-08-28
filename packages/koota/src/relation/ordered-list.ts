import type { Entity } from '../entity/types';
import type { World } from '../world';
import type { Relation } from './types';
import type { Trait } from '../trait/types';
import { addTrait, removeTrait } from '../trait/trait';
import { setChanged } from '../query/modifiers/changed';

/**
 * An ordered list of entities that syncs with a relation.
 * Extends Array to provide native array methods while keeping relation pairs in sync.
 *
 * @experimental This API is experimental and may change in future versions.
 * Please provide feedback on GitHub or Discord.
 */
export class OrderedList extends Array<Entity> {
  private world: World;
  private parent: Entity;
  private relation: Relation;
  private orderedTrait: Trait;
  private _syncing: boolean = false;

  constructor(
    world: World,
    parent: Entity,
    relation: Relation,
    orderedTrait: Trait,
    items: Entity[] = []
  ) {
    super(...items);
    this.world = world;
    this.parent = parent;
    this.relation = relation;
    this.orderedTrait = orderedTrait;
  }

  get [Symbol.toStringTag]() {
    return 'OrderedList';
  }

  /**
   * Add entities to the end of the list and add relation pairs.
   */
  override push(...items: Entity[]): number {
    this._syncing = true;
    try {
      for (const item of items) {
        addTrait(this.world, item, this.relation(this.parent));
      }
      const result = super.push(...items);
      setChanged(this.world, this.parent, this.orderedTrait);
      return result;
    } finally {
      this._syncing = false;
    }
  }

  /**
   * Remove and return the last entity, removing its relation pair.
   */
  override pop(): Entity | undefined {
    this._syncing = true;
    try {
      const item = super.pop();
      if (item !== undefined) {
        removeTrait(this.world, item, this.relation(this.parent));
        setChanged(this.world, this.parent, this.orderedTrait);
      }
      return item;
    } finally {
      this._syncing = false;
    }
  }

  /**
   * Remove and return the first entity, removing its relation pair.
   */
  override shift(): Entity | undefined {
    this._syncing = true;
    try {
      const item = super.shift();
      if (item !== undefined) {
        removeTrait(this.world, item, this.relation(this.parent));
        setChanged(this.world, this.parent, this.orderedTrait);
      }
      return item;
    } finally {
      this._syncing = false;
    }
  }

  /**
   * Add entities to the beginning of the list and add relation pairs.
   */
  override unshift(...items: Entity[]): number {
    this._syncing = true;
    try {
      for (const item of items) {
        addTrait(this.world, item, this.relation(this.parent));
      }
      const result = super.unshift(...items);
      setChanged(this.world, this.parent, this.orderedTrait);
      return result;
    } finally {
      this._syncing = false;
    }
  }

  /**
   * Remove and/or insert entities, syncing relation pairs.
   */
  override splice(start: number, deleteCount?: number, ...items: Entity[]): Entity[] {
    this._syncing = true;
    try {
      const removed = super.splice(start, deleteCount ?? 0, ...items);

      // Remove relation pairs for removed items
      for (const item of removed) {
        removeTrait(this.world, item, this.relation(this.parent));
      }

      // Add relation pairs for inserted items
      for (const item of items) {
        addTrait(this.world, item, this.relation(this.parent));
      }

      if (removed.length > 0 || items.length > 0) {
        setChanged(this.world, this.parent, this.orderedTrait);
      }

      return removed;
    } finally {
      this._syncing = false;
    }
  }

  /**
   * Sort the list in place. Does not modify relations.
   */
  override sort(compareFn?: (a: Entity, b: Entity) => number): this {
    super.sort(compareFn);
    setChanged(this.world, this.parent, this.orderedTrait);
    return this;
  }

  /**
   * Reverse the list in place. Does not modify relations.
   */
  override reverse(): this {
    super.reverse();
    setChanged(this.world, this.parent, this.orderedTrait);
    return this;
  }

  /**
   * Override map to return a plain array instead of OrderedList.
   */
  override map<U>(callbackfn: (value: Entity, index: number, array: Entity[]) => U): U[] {
    return Array.prototype.map.call(this, callbackfn) as U[];
  }

  /**
   * Override filter to return a plain array instead of OrderedList.
   */
  override filter(predicate: (value: Entity, index: number, array: Entity[]) => boolean): Entity[] {
    return Array.prototype.filter.call(this, predicate) as Entity[];
  }

  /**
   * Override slice to return a plain array instead of OrderedList.
   */
  override slice(start?: number, end?: number): Entity[] {
    return Array.prototype.slice.call(this, start, end) as Entity[];
  }

  /**
   * Move an entity to a specific index in the list.
   * Does not modify the relation, only reorders.
   */
  moveTo(item: Entity, toIndex: number): void {
    const fromIndex = this.indexOf(item);
    if (fromIndex === -1) {
      throw new Error('Item not found in OrderedList');
    }
    if (fromIndex === toIndex) return;

    // Remove from current position
    super.splice(fromIndex, 1);

    // Insert at new position
    super.splice(toIndex, 0, item);

    setChanged(this.world, this.parent, this.orderedTrait);
  }

  /**
   * Insert an entity at a specific index and add its relation pair.
   */
  insert(item: Entity, index: number): void {
    this._syncing = true;
    try {
      addTrait(this.world, item, this.relation(this.parent));
      super.splice(index, 0, item);
      setChanged(this.world, this.parent, this.orderedTrait);
    } finally {
      this._syncing = false;
    }
  }

  /**
   * Internal method to append without triggering relation add.
   * Used by the sync system when a relation is added externally.
   */
  _appendWithoutSync(item: Entity): void {
    // Only append if not currently syncing (prevents double-add)
    if (!this._syncing) {
      super.push(item);
      setChanged(this.world, this.parent, this.orderedTrait);
    }
  }

  /**
   * Internal method to remove without triggering relation remove.
   * Used by the sync system when a relation is removed externally.
   */
  _removeWithoutSync(item: Entity): void {
    // Only remove if not currently syncing (prevents double-remove)
    if (!this._syncing) {
      const index = this.indexOf(item);
      if (index !== -1) {
        super.splice(index, 1);
        setChanged(this.world, this.parent, this.orderedTrait);
      }
    }
  }
}
