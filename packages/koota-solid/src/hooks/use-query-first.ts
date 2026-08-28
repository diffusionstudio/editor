import type { Entity, QueryParameter } from '@diffusionstudio/koota';
import type { Accessor } from 'solid-js';
import { useQuery } from './use-query';

export function useQueryFirst<T extends QueryParameter[]>(
	...parameters: T
): Accessor<Entity | undefined> {
	const query = useQuery(...parameters);
	return () => query()[0];
}
