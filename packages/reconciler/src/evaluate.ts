/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import * as solid from 'solid-js';
import * as solidStore from 'solid-js/store';

import { JSX_RUNTIME } from './runtime';

// What the desktop compile step marks external is what is handed out here,
// so a project shares the app's solid-js instance (one reactive graph) and
// its JSX runtime — the authoring package's exports bound to this host, not
// the host-less copy in the project's node_modules.
const MODULES: Record<string, unknown> = {
	'solid-js': solid,
	'solid-js/store': solidStore,
	'@diffusionstudio/jsx': JSX_RUNTIME,
};

/** Evaluates a compiled CommonJS bundle and returns its default export. */
export function evaluate(code: string): () => unknown {
	const module = { exports: {} as { default?: unknown } };

	const require = (id: string): unknown => {
		const resolved = MODULES[id];
		if (!resolved) throw new Error(`Cannot import "${id}" — only solid-js and @diffusionstudio/jsx are available.`);
		return resolved;
	};

	new Function('require', 'module', 'exports', `${code}\n//# sourceURL=project.js`)(require, module, module.exports);

	const component = module.exports.default;
	if (typeof component !== 'function') {
		throw new Error('The entry file must export a component as default.');
	}
	return component as () => unknown;
}
