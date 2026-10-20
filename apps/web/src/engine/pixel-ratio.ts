/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * A ResizeObserver misses a `devicePixelRatio` change, because no CSS size changes.
 */
export function watchPixelRatio(onChange: () => void): () => void {
	const matchCurrent = (): MediaQueryList => window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);

	let query = matchCurrent();

	const handleChange = (): void => {
		query.removeEventListener('change', handleChange);
		query = matchCurrent();
		query.addEventListener('change', handleChange);
		onChange();
	};

	query.addEventListener('change', handleChange);
	return () => query.removeEventListener('change', handleChange);
}
