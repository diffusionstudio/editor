/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Tickers } from '@diffusionstudio/runtime';

import { createRuntimeDocument } from './document';
import { evaluate } from './evaluate';
import { renderProject } from './renderer';

import type { World } from '@diffusionstudio/koota';

export interface Mount {
	/** Tears down the reactive graph and every entity the project rendered. */
	dispose(): void;
}

/**
 * Renders a compiled project bundle into `world`. Throws if the bundle does
 * not evaluate, if its root is not a <stage>, or if `world` still has a
 * mounted project (dispose that one first — the stage is a singleton, so
 * two mounts would render into each other); nothing is left behind in the
 * world when it throws.
 *
 * The mount stays live: it puts the document's ticker advance into the
 * world's `Tickers`, and the playback system fires it once per tick, which
 * is what `useTicker` subscribes to.
 */
export function mount(code: string, world: World): Mount {
	const component = evaluate(code);
	const document = createRuntimeDocument(world);

	let dispose: () => void;
	try {
		dispose = renderProject(component, document);
	} catch (error) {
		document.dispose();
		throw error;
	}

	const advance = () => document.advanceTicker();
	world.get(Tickers)?.add(advance);

	return {
		dispose() {
			world.get(Tickers)?.delete(advance);
			// Solid's universal render disposer only drops the reactive graph;
			// the document owns the entities.
			dispose();
			document.dispose();
		},
	};
}
