/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Placeholders for the generative AI features, which are being rebuilt. The
// prompt box and the action bar stay in place; every action that would have reached a model lands here instead.

import { toast } from "somoto";

/** Tells the user `feature` is not wired up yet. */
export function notAvailable(feature: string): void {
  toast(`${feature} is not available yet`, {
    id: `genai-placeholder:${feature}`,
    description: "Generative AI features are being rebuilt.",
  });
}
