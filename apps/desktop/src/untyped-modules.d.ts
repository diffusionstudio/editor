/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Babel presets ship no type declarations; they are only ever passed opaquely
// into @babel/core's `presets` option.
declare module "babel-preset-solid" {
  const preset: unknown;
  export default preset;
}

declare module "@babel/preset-typescript" {
  const preset: unknown;
  export default preset;
}

// The tray icons, bundled into main.js as bytes (`--loader:.png=binary`):
// the packaged app ships dist/ and web/ only.
declare module "*.png" {
  const bytes: Uint8Array;
  export default bytes;
}
