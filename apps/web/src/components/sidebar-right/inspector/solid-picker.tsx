/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ColorOpacityPicker } from "@/components/ui/color-opacity-picker";
import { useWorld } from "@diffusionstudio/koota-solid";
import { Computed, colorToHex } from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { syncKeyframe } from "@/engine/keyframes";

import type { Entity } from "@diffusionstudio/koota";

export type SolidFillPickerProps = {
  fill: Entity;
};

/** A `<solidPaint>`'s color and opacity. `color` is required, never unset. */
export function SolidFillPicker(props: SolidFillPickerProps) {
  const world = useWorld();
  const editor = useEditor();

  const color = useDerived(() => props.fill.get(Computed)?.color ?? 0xE0E0E0);
  const opacity = useDerived(() => props.fill.get(Computed)?.opacity ?? 1);

  const updateColor = (next: number) => {
    const hex = colorToHex(next);
    editor.editProperty(props.fill, "color", hex);
    syncKeyframe(world, editor, props.fill, "color", hex);
  };

  const updateOpacity = (next: number) => {
    const value = Math.round(next * 100) / 100;
    editor.editProperty(props.fill, "opacity", value === 1 ? false : value);
    syncKeyframe(world, editor, props.fill, "opacity", value);
  };

  return (
    <ColorOpacityPicker
      color={color()}
      opacity={opacity()}
      onColorChange={updateColor}
      onOpacityChange={updateOpacity}
      keyframeTarget={props.fill}
    />
  );
}
