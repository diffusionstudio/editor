/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Icon } from "@/components/ui/icon";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorSeparator,
  FloatingInspectorTitle,
} from "@/components/ui/floating-inspector";
import { ControlRow } from "@/components/ui/control-group";
import { ColorOpacityRow } from "@/components/ui/color-opacity-row";
import { ColorOpacityPicker } from "@/components/ui/color-opacity-picker";
import { ControlledTextField } from "@/components/ui/text-field";
import { IncrementDecrementControl } from "@/components/ui/increment-decrement-control";
import { Keyframe } from "@/components/ui/keyframe";
import { useWorld } from "@diffusionstudio/koota-solid";
import { Computed, colorToHex } from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { syncKeyframe } from "@/engine/keyframes";

import type { Entity } from "@diffusionstudio/koota";

/** `<shadow>`'s defaults; a control left at one of these unsets its prop. */
const DEFAULT_OPACITY = 1;
const DEFAULT_OFFSET = 0;
const DEFAULT_BLUR = 0;

type ShadowInspectorProps = {
  shadow: Entity;
  anchorRef: HTMLElement;
  onClose(): void;
};

/**
 * One `<shadow>`: its paint (color and opacity) and how it is cast (offset
 * and blur). A shadow is a solid color and takes no paint children, so the
 * color half is the color picker alone, with no gradient or asset tab.
 */
export function ShadowInspector(props: ShadowInspectorProps) {
  const world = useWorld();
  const editor = useEditor();

  let colorRowRef: HTMLDivElement | undefined;

  const [pickingColor, setPickingColor] = createSignal(false);

  const color = useDerived(() => props.shadow.get(Computed)?.color ?? 0);
  const opacity = useDerived(() => props.shadow.get(Computed)?.opacity ?? DEFAULT_OPACITY);
  const offsetX = useDerived(() => props.shadow.get(Computed)?.offsetX ?? DEFAULT_OFFSET);
  const offsetY = useDerived(() => props.shadow.get(Computed)?.offsetY ?? DEFAULT_OFFSET);
  const blur = useDerived(() => props.shadow.get(Computed)?.blur ?? DEFAULT_BLUR);

  /** A shadow's color is required, never unset. */
  const editColor = (value: number) => {
    const hex = colorToHex(value);
    editor.editProperty(props.shadow, "color", hex);
    syncKeyframe(world, editor, props.shadow, "color", hex);
  };

  const editOpacity = (value: number) => {
    const next = Math.round(value * 100) / 100;
    editor.editProperty(props.shadow, "opacity", next === DEFAULT_OPACITY ? false : next);
    syncKeyframe(world, editor, props.shadow, "opacity", next);
  };

  const editOffset = (axis: "offsetX" | "offsetY", value: number) => {
    editor.editProperty(props.shadow, axis, value === DEFAULT_OFFSET ? false : value);
    syncKeyframe(world, editor, props.shadow, axis, value);
  };

  const editBlur = (value: number) => {
    editor.editProperty(props.shadow, "blur", value === DEFAULT_BLUR ? false : value);
    syncKeyframe(world, editor, props.shadow, "blur", value);
  };

  const handleClose = () => {
    setPickingColor(false);
    props.onClose();
  };

  return (
    <>
      <FloatingInspector open anchorRef={props.anchorRef} width={248}>
        <FloatingInspectorHeader class="items-center justify-between">
          <FloatingInspectorTitle>Drop Shadow</FloatingInspectorTitle>
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={handleClose}
            >
              <Icon name="close-remove" />
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        </FloatingInspectorHeader>
        <FloatingInspectorSeparator />
        <FloatingInspectorContent class="flex flex-col gap-2 p-4">
          <ControlRow label="Color" ref={colorRowRef}>
            <ColorOpacityRow
              color={color()}
              onChangeColor={editColor}
              opacity={opacity()}
              onChangeOpacity={editOpacity}
              onClick={() => setPickingColor(true)}
              keyframe={<Keyframe target={props.shadow} property="opacity" />}
            />
          </ControlRow>

          <ControlRow label="Position">
            <div class="grid grid-cols-2 gap-2">
              <ControlledTextField
                icon={<Icon name="prop-x-position" class="size-6" />}
                value={offsetX()}
                onNumber={(value) => editOffset("offsetX", value)}
                autoSelect
                sliderEnabled
                limitEvents
                keyframe={<Keyframe target={props.shadow} property="offsetX" />}
              />
              <ControlledTextField
                icon={<Icon name="prop-y-position" class="size-6" />}
                value={offsetY()}
                onNumber={(value) => editOffset("offsetY", value)}
                autoSelect
                sliderEnabled
                limitEvents
                keyframe={<Keyframe target={props.shadow} property="offsetY" />}
              />
            </div>
          </ControlRow>

          <ControlRow label="Blur">
            <div class="grid grid-cols-2 gap-2">
              <ControlledTextField
                value={blur()}
                onNumber={editBlur}
                min={0}
                autoSelect
                limitEvents
                keyframe={<Keyframe target={props.shadow} property="blur" />}
              />
              <IncrementDecrementControl
                onDecrement={() => editBlur(Math.max(0, blur() - 1))}
                onIncrement={() => editBlur(blur() + 1)}
                decrementLabel="Decrease blur"
                incrementLabel="Increase blur"
              />
            </div>
          </ControlRow>
        </FloatingInspectorContent>
      </FloatingInspector>

      <FloatingInspector open={pickingColor} anchorRef={() => colorRowRef} offset={26}>
        <FloatingInspectorHeader>
          <FloatingInspectorTitle>Color</FloatingInspectorTitle>
          <div class="ml-auto">
            <Tooltip>
              <TooltipTrigger
                as={Button}
                size="icon"
                variant="ghost"
                class="text-muted-foreground"
                onClick={() => setPickingColor(false)}
              >
                <Icon name="close-remove" class="size-6" />
              </TooltipTrigger>
              <TooltipContent>Close</TooltipContent>
            </Tooltip>
          </div>
        </FloatingInspectorHeader>
        <FloatingInspectorContent class="p-0">
          <ColorOpacityPicker
            color={color()}
            opacity={opacity()}
            onColorChange={editColor}
            onOpacityChange={editOpacity}
            keyframeTarget={props.shadow}
          />
        </FloatingInspectorContent>
      </FloatingInspector>
    </>
  );
}
