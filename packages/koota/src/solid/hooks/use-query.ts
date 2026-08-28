import { $internal, createQuery, type QueryParameter, type QueryResult } from '../../index';
import { createSignal, onCleanup, type Accessor } from 'solid-js';
import { useWorld } from '../world/use-world';

export function useQuery<T extends QueryParameter[]>(
	...parameters: T
): Accessor<QueryResult<T>> {
	const world = useWorld();
	const queryRef = createQuery(...parameters);

	const [result, setResult] = createSignal<QueryResult<T>>(world.query(queryRef).sort(), {
		equals: false,
	});
	const update = () => setResult(world.query(queryRef).sort());

	let unsubAdd = () => {};
	let unsubRemove = () => {};

	const subscribe = () => {
		unsubAdd = world.onQueryAdd(queryRef, update);
		unsubRemove = world.onQueryRemove(queryRef, update);
	};

	const handleReset = () => {
		unsubAdd();
		unsubRemove();
		subscribe();
		update();
	};

	subscribe();
	world[$internal].resetSubscriptions.add(handleReset);

	onCleanup(() => {
		world[$internal].resetSubscriptions.delete(handleReset);
		unsubAdd();
		unsubRemove();
	});

	return result;
}
