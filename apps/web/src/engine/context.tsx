/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createContext, onCleanup, useContext, type JSX } from 'solid-js';
import { WorldProvider } from '@diffusionstudio/koota/solid';

import { createEngine, type Engine, type EngineOptions } from './create-engine';

const EngineContext = createContext<Engine>();

export interface EngineProviderProps {
	projectId: string;
	options?: EngineOptions;
	children?: JSX.Element;
}

/**
 * Provides the Engine instance (lifecycle: mount/resize/start/stop) and,
 * via @diffusionstudio/koota/solid's WorldProvider, its koota world. Deliberately does not
 * hand out a bag of engine internals — components read world-trait state
 * with useTrait/useQuery (see ./hooks) and reach the Engine itself only for
 * lifecycle calls (useEngineContext()), keeping each consumer's dependency
 * explicit instead of importing one god object.
 */
export function EngineProvider(props: EngineProviderProps): JSX.Element {
	const engine = createEngine(props.projectId, props.options);
	onCleanup(() => engine.dispose());

	return (
		<EngineContext.Provider value={engine}>
			<WorldProvider world={engine.world}>
				{props.children}
			</WorldProvider>
		</EngineContext.Provider>
	);
}

export function useEngineContext(): Engine {
	const engine = useContext(EngineContext);

	if (!engine) {
		throw new Error('useEngineContext must be used within an EngineProvider');
	}

	return engine;
}
