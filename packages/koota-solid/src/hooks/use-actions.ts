import type { World } from '@diffusionstudio/koota';
import { useWorld } from '../world/use-world';

export function useActions<T extends Record<string, (...args: any[]) => any>>(
	actions: (world: World) => T
) {
	const world = useWorld();
	return actions(world);
}
