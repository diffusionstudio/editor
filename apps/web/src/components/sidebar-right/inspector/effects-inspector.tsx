/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createUniqueId } from "solid-js";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ControlRow } from "@/components/ui/control-group";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorSeparator,
  FloatingInspectorTitle,
  FloatingInspectorLayer,
} from "@/components/ui/floating-inspector";
import { Icon } from "@/components/ui/icon";
import { IncrementDecrementControl } from "@/components/ui/increment-decrement-control";
import { Keyframe } from "@/components/ui/keyframe";
import { SliderInput } from "@/components/ui/slider-input";
import { ControlledTextField } from "@/components/ui/text-field";
import { useEngine } from "@/context/engine";
import { useEntityState, useEntityTag, EffectType, addComponent, removeComponent, setComponent } from "@/components/engine";
import { hasComponent } from 'bitecs';

type EffectsInspectorProps = {
  anchorRef: HTMLElement;
  triggerRef?: HTMLElement;
  onClose(): void;
  effectEid: number;
  nodeEid: number;
};

type Effects = Exclude<EffectType, EffectType.DROP_SHADOW>;

export const EFFECT_DEFAULTS: Record<Effects, { label: string; value: number }> = {
  [EffectType.LAYER_BLUR]: { label: "Layer Blur", value: 8 },
  [EffectType.BRIGHTNESS]: { label: "Brightness", value: 0.8 },
  [EffectType.CONTRAST]: { label: "Contrast", value: 0.8 },
  [EffectType.GRAYSCALE]: { label: "Grayscale", value: 0.5 },
  [EffectType.HUE_ROTATION]: { label: "Hue Rotation", value: 100 },
  [EffectType.INVERT]: { label: "Invert", value: 0.5 },
  [EffectType.SATURATE]: { label: "Saturate", value: 0.8 },
  [EffectType.SEPIA]: { label: "Sepia", value: 0.5 },
};

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

const AMOUNT_EFFECTS: Effects[] = [
  EffectType.BRIGHTNESS,
  EffectType.CONTRAST,
  EffectType.GRAYSCALE,
  EffectType.INVERT,
  EffectType.SATURATE,
  EffectType.SEPIA,
];

export function EffectsInspector(props: EffectsInspectorProps) {
  const { world } = useEngine();
  const c = world.components;

  const titleId = createUniqueId();

  const effectValue = useEntityState(c.Computed.value, () => props.effectEid, 0);
  const hidden = useEntityTag(c.Hidden, () => props.effectEid);
  const type = useEntityState(c.Effect.type, () => props.effectEid, EffectType.BRIGHTNESS);

  const updateValue = (v: number) => {
    setComponent(world, props.effectEid, c.Effect, { value: v });
  };

  const toggleVisible = () => {
    if (hasComponent(world, props.effectEid, c.Hidden)) {
      removeComponent(world, props.effectEid, c.Hidden);
    } else {
      addComponent(world, props.effectEid, c.Hidden);
    }
  };

  const isAmountEffect = () => AMOUNT_EFFECTS.includes(type() ?? EffectType.BRIGHTNESS);
  const isBlurEffect = () => type() === EffectType.LAYER_BLUR;
  const isHueRotationEffect = () => type() === EffectType.HUE_ROTATION;
  const label = () => EFFECT_DEFAULTS[type() as Effects]?.label ?? "";

  return (
    <FloatingInspectorLayer
      onDismiss={props.onClose}
      triggerRef={props.triggerRef}
      triggerControlSelector="[data-row-control]"
      labelledBy={titleId}
    >
    <FloatingInspector open={true} anchorRef={props.anchorRef} width={248}>
      <FloatingInspectorHeader class="items-center justify-between">
        <FloatingInspectorTitle id={titleId}>{label()}</FloatingInspectorTitle>
        <div class="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={toggleVisible}
            >
              {!hidden() ? <Icon name="eye-on" /> : <Icon name="eye-off" />}
            </TooltipTrigger>
            <TooltipContent>{hidden() ? "Show effect" : "Hide effect"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={props.onClose}
            >
              <Icon name="close-remove" />
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        </div>
      </FloatingInspectorHeader>
      <FloatingInspectorSeparator />
      <FloatingInspectorContent class="flex flex-col gap-2 p-4">
        {isAmountEffect() && (
          <ControlRow label="Amount">
            <SliderInput
              value={Math.round(clampUnit(effectValue()) * 100)}
              min={0}
              max={100}
              onChange={(v) => updateValue(clampUnit(v / 100))}
              onDragStart={() => world.history.startTransaction("Edit effect amount")}
              onDragEnd={() => world.history.commitTransaction()}
              format={(v) => `${v}%`}
              keyframe={<Keyframe target={props.effectEid} property="effect.value" />}
            />
          </ControlRow>
        )}

        {isBlurEffect() && (
          <ControlRow label="Radius">
            <div class="grid grid-cols-2 gap-2">
              <ControlledTextField
                value={effectValue()}
                onNumber={(v) => updateValue(Math.max(0, v))}
                min={0}
                autoSelect
                sliderEnabled
                limitEvents
                keyframe={<Keyframe target={props.effectEid} property="effect.value" />}
              />
              <IncrementDecrementControl
                onDecrement={() => updateValue(Math.max(0, (effectValue() ?? 0) - 1))}
                onIncrement={() => updateValue((effectValue() ?? 0) + 1)}
                decrementLabel="Decrease blur radius"
                incrementLabel="Increase blur radius"
              />
            </div>
          </ControlRow>
        )}

        {isHueRotationEffect() && (
          <ControlRow label="Angle">
            <ControlledTextField
              icon={<Icon name="rotate-angle" class="size-6" />}
              value={effectValue()}
              onNumber={(v) => updateValue(v)}
              unit="deg"
              step={1}
              autoSelect
              sliderEnabled
              limitEvents
              keyframe={<Keyframe target={props.effectEid} property="effect.value" />}
            />
          </ControlRow>
        )}
      </FloatingInspectorContent>
    </FloatingInspector>
    </FloatingInspectorLayer>
  );
}
