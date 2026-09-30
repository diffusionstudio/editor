/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The environment's FontFaceSet: document.fonts on a page, self.fonts in a worker. */
export function getFontFaceSet(): FontFaceSet | null {
	const scope = globalThis as { document?: { fonts?: FontFaceSet }; fonts?: FontFaceSet };
	return scope.document?.fonts ?? scope.fonts ?? null;
}
