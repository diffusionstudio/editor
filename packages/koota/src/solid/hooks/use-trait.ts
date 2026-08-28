import { $internal, type Entity, type RelationPair, type Trait, type TraitRecord, type World } from '../../index';
import { createComputed, createSignal, onCleanup, type Accessor } from 'solid-js';
import { isWorld } from '../utils/is-world';
import { access, createStableTrait, type MaybeAccessor } from '../utils/reactive-args';
import { useWorld } from '../world/use-world';

// Overloads split the trait union so T infers from a plain trait argument;
// a single MaybeAccessor<T | RelationPair<T>> parameter defeats inference
// and silently widens the result to Accessor<any>.
export function useTrait<T extends Trait>(
	target: MaybeAccessor<Entity | World | undefined | null>,
	trait: T | RelationPair<T>
): Accessor<TraitRecord<T> | undefined>;
export function useTrait<T extends Trait>(
	target: MaybeAccessor<Entity | World | undefined | null>,
	trait: Accessor<T | RelationPair<T>>
): Accessor<TraitRecord<T> | undefined>;
export function useTrait<T extends Trait>(
	target: MaybeAccessor<Entity | World | undefined | null>,
	trait: MaybeAccessor<T | RelationPair<T>>
): Accessor<TraitRecord<T> | undefined> {
	const contextWorld = useWorld();
	const stableTrait = createStableTrait(trait);

	const [value, setValue] = createSignal<TraitRecord<T> | undefined>(undefined, {
		equals: false,
	});

	createComputed(() => {
		const currentTarget = access(target);
		const currentTrait = stableTrait();

		if (!currentTarget) {
			setValue(undefined);
			return;
		}

		// Use the context world unless the target is a world itself
		const world = isWorld(currentTarget) ? currentTarget : contextWorld;
		const entity = isWorld(currentTarget) ? currentTarget[$internal].worldEntity : currentTarget;

		const onChangeUnsub = world.onChange(currentTrait, (e) => {
			if (e === entity) setValue(() => e.get(currentTrait));
		});

		const onAddUnsub = world.onAdd(currentTrait, (e) => {
			if (e === entity) setValue(() => e.get(currentTrait));
		});

		const onRemoveUnsub = world.onRemove(currentTrait, (e) => {
			if (e === entity) setValue(undefined);
		});

		setValue(() => (entity.has(currentTrait) ? entity.get(currentTrait) : undefined));

		onCleanup(() => {
			onChangeUnsub();
			onAddUnsub();
			onRemoveUnsub();
		});
	});

	return value;
}
