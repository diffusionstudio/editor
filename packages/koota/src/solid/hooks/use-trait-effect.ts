import { $internal, type Entity, type RelationPair, type Trait, type TraitRecord, type World } from '../../index';
import { createEffect, onCleanup, untrack, type Accessor } from 'solid-js';
import { isWorld } from '../utils/is-world';
import { access, createStableTrait, type MaybeAccessor } from '../utils/reactive-args';
import { useWorld } from '../world/use-world';

// See use-trait.ts: the union must be split across overloads, not baked
// into a single MaybeAccessor<T | RelationPair<T>> parameter, or T fails to
// infer from a plain trait argument and callback silently widens to any.
export function useTraitEffect<T extends Trait>(
	target: MaybeAccessor<Entity | World>,
	trait: T | RelationPair<T>,
	callback: (value: TraitRecord<T> | undefined) => void
): void;
export function useTraitEffect<T extends Trait>(
	target: MaybeAccessor<Entity | World>,
	trait: Accessor<T | RelationPair<T>>,
	callback: (value: TraitRecord<T> | undefined) => void
): void;
export function useTraitEffect<T extends Trait>(
	target: MaybeAccessor<Entity | World>,
	trait: MaybeAccessor<T | RelationPair<T>>,
	callback: (value: TraitRecord<T> | undefined) => void
): void {
	const contextWorld = useWorld();
	const stableTrait = createStableTrait(trait);

	createEffect(() => {
		const currentTarget = access(target);
		const currentTrait = stableTrait();

		const world = isWorld(currentTarget) ? currentTarget : contextWorld;
		const entity = isWorld(currentTarget) ? currentTarget[$internal].worldEntity : currentTarget;

		const onChangeUnsub = world.onChange(currentTrait, (e) => {
			if (e === entity) callback(e.get(currentTrait));
		});

		const onAddUnsub = world.onAdd(currentTrait, (e) => {
			if (e === entity) callback(e.get(currentTrait));
		});

		const onRemoveUnsub = world.onRemove(currentTrait, (e) => {
			if (e === entity) callback(undefined);
		});

		untrack(() => callback(entity.has(currentTrait) ? entity.get(currentTrait) : undefined));

		onCleanup(() => {
			onChangeUnsub();
			onAddUnsub();
			onRemoveUnsub();
		});
	});
}
