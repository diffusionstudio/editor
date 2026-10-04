/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// How the selection was generated and what it cost: a placeholder until the
// generative features are back (see ./placeholder). Nothing reads as
// generated, so "Rerun", "Reuse" and the credits line stay hidden.

import type { GenerationConfig } from "./schemas";

export function useGenerationRecords() {
  const isGenerated = (): boolean => false;
  const totalCredits = (): number => 0;
  const firstConfig = (): GenerationConfig | undefined => undefined;
  return { isGenerated, totalCredits, firstConfig };
}
