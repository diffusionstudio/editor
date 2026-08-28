import type { World } from '@diffusionstudio/koota';
import { createComponent, type JSX } from 'solid-js';
import { WorldContext } from './world-context';

export function WorldProvider(props: { world: World; children?: JSX.Element }): JSX.Element {
	return createComponent(WorldContext.Provider, {
		get value() {
			return props.world;
		},
		get children() {
			return props.children;
		},
	});
}
