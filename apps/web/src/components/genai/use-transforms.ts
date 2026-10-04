/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Upscaling, taking a background out, scoring footage: placeholders until the
// generative features are back (see ./placeholder).

import { notAvailable } from "./placeholder";

import type { TransformType } from "./schemas";

const LABELS: Record<TransformType, string> = {
  upscale: "Upscaling",
  removeBackground: "Background removal",
  addAudio: "Adding audio",
};

export function useTransforms() {
  const isOn = (_type: TransformType): boolean => false;
  const toggle = (type: TransformType): void => notAvailable(LABELS[type]);
  return { isOn, toggle };
}
