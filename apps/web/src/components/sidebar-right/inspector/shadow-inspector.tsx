/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal, createUniqueId, createEffect, on, Show } from 'solid-js';
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Icon } from "@/components/ui/icon";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorTitle,
  FloatingInspectorSeparator,
  FloatingInspectorLayer,
} from "@/components/ui/floating-inspector";
import { ControlRow } from "@/components/ui/control-group";
import { ColorOpacityRow } from "@/components/ui/color-opacity-row";
import { ColorOpacityPicker } from "@/components/ui/color-opacity-picker";
import { ControlledTextField } from "@/components/ui/text-field";
import { IncrementDecrementControl } from "@/components/ui/increment-decrement-control";
import { useEntityState, setComponent } from "@/components/engine";
import { useEngine } from "@/context/engine";
import { Keyframe } from "@/components/ui/keyframe";


type ShadowInspectorProps = {
  onClose(): void;
  anchorRef: HTMLElement;
  triggerRef?: HTMLElement;
  nodeEid: number;
  shadowEid: number;
};

export function ShadowInspector(props: ShadowInspectorProps) {
  let colorRowRef: HTMLDivElement | undefined;

  const { world } = useEngine();
  const c = world.components;

  const titleId = createUniqueId();
  const [isColorPickerOpen, setIsColorPickerOpen] = createSignal(false);

  createEffect(on(() => props.shadowEid, () => setIsColorPickerOpen(false), { defer: true }));

  const color = useEntityState(c.Computed.color, () => props.shadowEid, 0x000000);
  const opacity = useEntityState(c.Computed.opacity, () => props.shadowEid, 0.25);
  const offsetX = useEntityState(c.Computed.offsetX, () => props.shadowEid, 0);
  const offsetY = useEntityState(c.Computed.offsetY, () => props.shadowEid, 4);
  const blur = useEntityState(c.Computed.blur, () => props.shadowEid, 0);

  const updateColor = (color: number) => {
    setComponent(world, props.shadowEid, c.Color, color);
  };
  const updateOpacity = (opacity: number) => {
    setComponent(world, props.shadowEid, c.Appearance, { opacity });
  };
  const updateOffsetX = (x: number) => {
    setComponent(world, props.shadowEid, c.Offset, { x });
  };
  const updateOffsetY = (y: number) => {
    setComponent(world, props.shadowEid, c.Offset, { y });
  };
  const updateBlur = (blur: number) => {
    setComponent(world, props.shadowEid, c.Blur, blur);
  };

  const handleClose = () => {
    setIsColorPickerOpen(false);
    props.onClose();
  };


  return (
    <FloatingInspectorLayer
      onDismiss={handleClose}
      triggerRef={props.triggerRef}
      triggerControlSelector="[data-row-control]"
      labelledBy={titleId}
    >
      <FloatingInspector
        open={true}
        anchorRef={props.anchorRef}
        width={248}
      >
        <FloatingInspectorHeader class="items-center justify-between">
          <FloatingInspectorTitle id={titleId}>
            Drop Shadow
          </FloatingInspectorTitle>
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
              onChangeColor={updateColor}
              opacity={opacity()}
              onChangeOpacity={updateOpacity}
              onStartTransaction={() => world.history.startTransaction("Edit shadow opacity")}
              onEndTransaction={() => world.history.commitTransaction()}
              onClick={() => setIsColorPickerOpen((open) => !open)}
            />
          </ControlRow>

          <ControlRow label="Position">
            <div class="grid grid-cols-2 gap-2">
              <ControlledTextField
                icon={<Icon name="prop-x-position" class="size-6" />}
                value={offsetX()}
                onNumber={updateOffsetX}
                autoSelect
                sliderEnabled
                limitEvents
                keyframe={<Keyframe target={props.shadowEid} property="offset.x" />}
              />
              <ControlledTextField
                icon={<Icon name="prop-y-position" class="size-6" />}
                value={offsetY()}
                onNumber={updateOffsetY}
                autoSelect
                sliderEnabled
                limitEvents
                keyframe={<Keyframe target={props.shadowEid} property="offset.y" />}
              />
            </div>
          </ControlRow>

          <ControlRow label="Blur">
            <div class="grid grid-cols-2 gap-2">
              <ControlledTextField
                value={blur()}
                onNumber={updateBlur}
                min={0}
                autoSelect
                limitEvents
                keyframe={<Keyframe target={props.shadowEid} property="blur" />}
              />
              <IncrementDecrementControl
                onDecrement={() => updateBlur(Math.max(0, blur() - 1))}
                onIncrement={() => updateBlur(blur() + 1)}
                decrementLabel="Decrease blur"
                incrementLabel="Increase blur"
              />
            </div>
          </ControlRow>
        </FloatingInspectorContent>
      </FloatingInspector>

      <Show when={isColorPickerOpen()}>
        <FloatingInspectorLayer modal onDismiss={() => setIsColorPickerOpen(false)}>
          <FloatingInspector
            open={true}
            anchorRef={() => colorRowRef}
            offset={26}
          >
            <FloatingInspectorHeader>
              <FloatingInspectorTitle>Color</FloatingInspectorTitle>
              <div class="ml-auto">
                <Tooltip>
                  <TooltipTrigger
                    as={Button}
                    size="icon"
                    variant="ghost"
                    class="text-muted-foreground"
                    onClick={() => setIsColorPickerOpen(false)}
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
                onColorChange={updateColor}
                onOpacityChange={updateOpacity}
                onBeginChange={(label) => world.history.startTransaction(label)}
                onEndChange={() => world.history.commitTransaction()}
                keyframeTarget={props.shadowEid}
              />
            </FloatingInspectorContent>
          </FloatingInspector>
        </FloatingInspectorLayer>
      </Show>
    </FloatingInspectorLayer>
  );
}
