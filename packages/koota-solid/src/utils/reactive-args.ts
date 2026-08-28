import { $internal, $relationPair, type RelationPair, type Trait } from '@diffusionstudio/koota';
import { createMemo, type Accessor } from 'solid-js';

export type MaybeAccessor<T> = T | Accessor<T>;

export function access<T>(value: MaybeAccessor<T>): T {
	return typeof value === 'function' ? (value as Accessor<T>)() : value;
}

export type TraitOrPair<T extends Trait = Trait> = T | RelationPair<T>;

export function isRelationPair(value: unknown): value is RelationPair {
	return !!(value as any)?.[$relationPair];
}

/**
 * Traits and relations are themselves functions, so a plain typeof check
 * can't tell them apart from accessors. Koota values carry marker symbols.
 */
function accessTrait<TP>(value: MaybeAccessor<TP>): TP {
	if (
		typeof value === 'function' &&
		!($internal in value) &&
		!($relationPair in value)
	) {
		return (value as Accessor<TP>)();
	}
	return value as TP;
}

/**
 * Stabilizes a trait-or-pair argument. Plain traits are referentially stable
 * (defined once), but relation pairs like `ChildOf(parent())` create a new
 * object each evaluation, so the memo only notifies when the underlying
 * relation + target identity changes.
 */
export function createStableTrait<TP extends TraitOrPair>(
	input: MaybeAccessor<TP>
): Accessor<TP> {
	return createMemo(() => accessTrait(input), undefined, {
		equals: (a, b) => relationOf(a) === relationOf(b) && targetOf(a) === targetOf(b),
	});
}

function relationOf(value: TraitOrPair): unknown {
	return isRelationPair(value) ? value.relation : value;
}

function targetOf(value: TraitOrPair): unknown {
	return isRelationPair(value) ? value.target : undefined;
}
