import type { World } from '../../index';
import { useContext } from 'solid-js';
import { WorldContext } from './world-context';

export function useWorld(): World {
	const world = useContext(WorldContext);

	if (!world) {
		throw new Error('Koota: useWorld must be used within a WorldProvider');
	}

	return world;
}
