import { $internal, type Entity, type Relation, type Trait, type World } from '@diffusionstudio/koota';
import { createComputed, createSignal, onCleanup, type Accessor } from 'solid-js';
import { isWorld } from '../utils/is-world';
import { access, type MaybeAccessor } from '../utils/reactive-args';
import { useWorld } from '../world/use-world';

export function useTarget<T extends Trait>(
	target: MaybeAccessor<Entity | World | undefined | null>,
	relation: Relation<T>
): Accessor<Entity | undefined> {
	const contextWorld = useWorld();
	const [value, setValue] = createSignal<Entity | undefined>(undefined);

	createComputed(() => {
		const currentTarget = access(target);

		if (!currentTarget) {
			setValue(undefined);
			return;
		}

		const world = isWorld(currentTarget) ? currentTarget : contextWorld;
		const entity = isWorld(currentTarget) ? currentTarget[$internal].worldEntity : currentTarget;

		const onAddUnsub = world.onAdd(relation, (e) => {
			if (e === entity) setValue(entity.targetFor(relation));
		});

		const onRemoveUnsub = world.onRemove(relation, (e) => {
			if (e === entity) setValue(undefined);
		});

		const onChangeUnsub = world.onChange(relation, (e) => {
			if (e === entity) setValue(entity.targetFor(relation));
		});

		setValue(entity.targetFor(relation));

		onCleanup(() => {
			onAddUnsub();
			onRemoveUnsub();
			onChangeUnsub();
		});
	});

	return value;
}
