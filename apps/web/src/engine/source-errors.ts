/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * A failed generation, written back to the JSX that asked for it. The runtime
 * leaves the reason on the entity (`SourceError`); this is what turns it into
 * the `error` prop of the element, so the failure lives where the rest of the
 * document lives — in the file — rather than only in the session that saw it.
 *
 * That is what keeps a generation from being run again: the project remounts
 * on every edit and is compiled afresh on every reload, and each time the
 * element carries the answer its declaration already got (see the asset
 * system, which leaves such an element alone). Taking the prop off the
 * element — in the file, like any other authored change — is what asks for
 * the run again; nothing else in the editor does it silently.
 *
 * Only generations are written: a load that failed is cheap to try again, and
 * an asset that has since been put back should simply load.
 */

import { SourceError } from '@diffusionstudio/runtime';
import { authoredElement } from '@diffusionstudio/reconciler';

import { getDocumentEditor, isLooped } from './editor';

import type { World } from '@diffusionstudio/koota';

export function sourceErrorSystem(world: World): void {
	for (const entity of world.query(SourceError)) {
		const failure = entity.get(SourceError)!;
		if (!failure.generated) continue;

		const authored = authoredElement(entity);
		// Nothing to write it to (an entity no element produced), or nothing
		// new to say.
		if (!authored || authored.props.error === failure.value) continue;

		// One element renders every iteration of a loop, so writing a prop to
		// one of them means unrolling the loop into the file. That is a change
		// to the project worth making when the user asks for one, and not
		// worth making behind their back over a generation that failed.
		if (isLooped(entity)) continue;

		getDocumentEditor(world).editProperty(entity, 'error', failure.value);
	}
}
