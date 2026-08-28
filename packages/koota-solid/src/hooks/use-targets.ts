import { $internal, type Entity, type Relation, type Trait, type World } from '@diffusionstudio/koota';
import { createComputed, createSignal, onCleanup, type Accessor } from 'solid-js';
import { isWorld } from '../utils/is-world';
import { access, type MaybeAccessor } from '../utils/reactive-args';
import { useWorld } from '../world/use-world';

export function useTargets<T extends Trait>(
	target: MaybeAccessor<Entity | World | undefined | null>,
	relation: Relation<T>
): Accessor<Entity[]> {
	const contextWorld = useWorld();
	const [value, setValue] = createSignal<Entity[]>([], { equals: false });

	createComputed(() => {
		const currentTarget = access(target);

		if (!currentTarget) {
			setValue([]);
			return;
		}

		const world = isWorld(currentTarget) ? currentTarget : contextWorld;
		const entity = isWorld(currentTarget) ? currentTarget[$internal].worldEntity : currentTarget;

		// Track current value for onRemove filter
		let currentValue: Entity[] = [];

		const update = (next: Entity[]) => {
			currentValue = next;
			setValue(next);
		};

		const onAddUnsub = world.onAdd(relation, (e) => {
			if (e === entity) update(entity.targetsFor(relation));
		});

		// onRemove fires before data is removed, so filter out the target
		const onRemoveUnsub = world.onRemove(relation, (e, t) => {
			if (e === entity) update(currentValue.filter((p) => p !== t));
		});

		const onChangeUnsub = world.onChange(relation, (e) => {
			if (e === entity) update(entity.targetsFor(relation));
		});

		update(entity.targetsFor(relation));

		onCleanup(() => {
			onAddUnsub();
			onRemoveUnsub();
			onChangeUnsub();
		});
	});

	return value;
}
