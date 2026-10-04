/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { notAvailable } from "./placeholder";

import type { VoiceGenerationConfig } from "./schemas";

export function useGenerateVoice() {
  const run = async (_config: VoiceGenerationConfig) => notAvailable("Voice generation");
  return { generate: run } as const;
}
