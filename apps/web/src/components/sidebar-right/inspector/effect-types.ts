/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { EFFECT_TYPES } from "@diffusionstudio/reconciler";

import type { EffectType as EffectName } from "@diffusionstudio/jsx";
import type { EffectType } from "@diffusionstudio/runtime";

/**
 * What an `<effect>`'s `value` means, which is what a type switch has to
 * answer for: the amount filters share a 0-1 scale, `blur` is a radius in px
 * and `hueRotate` an angle in degrees. Within a unit the value carries over,
 * across one it cannot.
 */
export type EffectUnit = "amount" | "px" | "deg";

export type EffectOption = {
  name: EffectName;
  label: string;
  unit: EffectUnit;
  /** What "Add effect", and a switch into this type, authors. */
  value: number;
};

/** The effect types, in menu order. */
export const EFFECT_OPTIONS: EffectOption[] = [
  { name: "blur", label: "Layer Blur", unit: "px", value: 8 },
  { name: "brightness", label: "Brightness", unit: "amount", value: 0.8 },
  { name: "opacity", label: "Opacity", unit: "amount", value: 1 },
  { name: "contrast", label: "Contrast", unit: "amount", value: 0.8 },
  { name: "grayscale", label: "Grayscale", unit: "amount", value: 0.5 },
  { name: "hueRotate", label: "Hue Rotation", unit: "deg", value: 100 },
  { name: "invert", label: "Invert", unit: "amount", value: 0.5 },
  { name: "saturate", label: "Saturate", unit: "amount", value: 0.8 },
  { name: "sepia", label: "Sepia", unit: "amount", value: 0.5 },
];

/** What the panel's plus inserts, spelled out. */
export const DEFAULT_EFFECT: EffectOption = EFFECT_OPTIONS[0]!;

const BY_TYPE = new Map<EffectType, EffectOption>(
  EFFECT_OPTIONS.map((option) => [EFFECT_TYPES[option.name]!, option]),
);

/**
 * The option for the type an `Effect` trait holds. Identity matters: the
 * type select compares its value against the array it was given, so this
 * hands back the option itself rather than a copy.
 */
export function effectOption(type: EffectType | undefined): EffectOption {
  return (type === undefined ? undefined : BY_TYPE.get(type)) ?? DEFAULT_EFFECT;
}
