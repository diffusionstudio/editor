import { $internal, type Entity, type TagTrait, type World } from '../../index';
import { createComputed, createSignal, onCleanup, type Accessor } from 'solid-js';
import { isWorld } from '../utils/is-world';
import { access, type MaybeAccessor } from '../utils/reactive-args';
import { useWorld } from '../world/use-world';

export function useTag(
	target: MaybeAccessor<Entity | World | undefined | null>,
	tag: TagTrait
): Accessor<boolean> {
	const contextWorld = useWorld();
	const [value, setValue] = createSignal(false);

	createComputed(() => {
		const currentTarget = access(target);

		if (!currentTarget) {
			setValue(false);
			return;
		}

		const world = isWorld(currentTarget) ? currentTarget : contextWorld;
		const entity = isWorld(currentTarget) ? currentTarget[$internal].worldEntity : currentTarget;

		const onAddUnsub = world.onAdd(tag, (e) => {
			if (e === entity) setValue(true);
		});

		const onRemoveUnsub = world.onRemove(tag, (e) => {
			if (e === entity) setValue(false);
		});

		setValue(entity.has(tag));

		onCleanup(() => {
			onAddUnsub();
			onRemoveUnsub();
		});
	});

	return value;
}
