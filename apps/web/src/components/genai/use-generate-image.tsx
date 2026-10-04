/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { notAvailable } from "./placeholder";

import type { ImageGenerationConfig } from "./schemas";

export function useGenerateImage() {
  const run = async (_config: ImageGenerationConfig) => notAvailable("Image generation");
  return { generate: run } as const;
}
