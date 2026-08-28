/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createMemo } from "solid-js";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ControlRow } from "@/components/ui/control-group";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorSeparator,
} from "@/components/ui/floating-inspector";
import { Icon } from "@/components/ui/icon";
import { IncrementDecrementControl } from "@/components/ui/increment-decrement-control";
import { Keyframe } from "@/components/ui/keyframe";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SliderInput } from "@/components/ui/slider-input";
import { ControlledTextField } from "@/components/ui/text-field";
import { useHas, useTrait, useWorld } from "@diffusionstudio/koota-solid";
import { Computed, Effect, Hidden } from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { removeKeyframeTrack, syncKeyframe } from "@/engine/keyframes";
import { EFFECT_OPTIONS, effectOption } from "./effect-types";

import type { EffectOption } from "./effect-types";
import type { Entity } from "@diffusionstudio/koota";

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

type EffectsInspectorProps = {
  effect: Entity;
  anchorRef: HTMLElement;
  onClose(): void;
};

/**
 * One `<effect>`: which filter it is and how much of it. Both are required
 * props, so neither is ever unset — an effect that says nothing is not an
 * effect. The type select stands where the title would (the export
 * inspector's shape): it names the effect *and* changes it, so a separate
 * heading would only say the same word twice. `value` is one number in three
 * units (px, degrees, a 0-1 amount), which is why the control below the type
 * changes with it.
 */
export function EffectsInspector(props: EffectsInspectorProps) {
  const world = useWorld();
  const editor = useEditor();

  const effect = useTrait(() => props.effect, Effect);
  const hidden = useHas(() => props.effect, Hidden);

  const option = createMemo(() => effectOption(effect()?.type));
  const value = useDerived(() => props.effect.get(Computed)?.value ?? 0);

  const editValue = (next: number) => {
    editor.editProperty(props.effect, "value", next);
    syncKeyframe(world, editor, props.effect, "value", next);
  };

  /**
   * Switches the filter. A value only means the same thing across types of
   * the same unit; crossing one (a 4px blur becoming 4 turns of sepia) takes
   * the new type's default, and the track goes with the numbers it held.
   */
  const handleTypeChange = (next: EffectOption | null) => {
    const previous = option();
    if (next === null || next.name === previous.name) return;

    if (next.unit !== previous.unit) {
      removeKeyframeTrack(world, editor, props.effect, "value");
    }
    editor.editProperty(props.effect, "type", next.name);
    if (next.unit !== previous.unit) {
      editor.editProperty(props.effect, "value", next.value);
    }
  };

  const toggleHidden = () => {
    editor.editProperty(props.effect, "hidden", !hidden());
  };

  return (
    <FloatingInspector open anchorRef={props.anchorRef} width={248}>
      <FloatingInspectorHeader class="items-center justify-between px-2">
        <Select<EffectOption>
          value={option()}
          onChange={handleTypeChange}
          options={EFFECT_OPTIONS}
          optionValue="name"
          optionTextValue="label"
          itemComponent={(itemProps) => (
            <SelectItem item={itemProps.item}>
              {itemProps.item.rawValue.label}
            </SelectItem>
          )}
        >
          <SelectTrigger>
            <SelectValue<EffectOption>>
              {(state) => state.selectedOption()?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectPortal>
            <SelectContent />
          </SelectPortal>
        </Select>
        <div class="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={toggleHidden}
            >
              <Show when={!hidden()} fallback={<Icon name="eye-off" />}>
                <Icon name="eye-on" />
              </Show>
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
        <Show when={option().unit === "amount"}>
          <ControlRow label="Amount">
            <SliderInput
              value={Math.round(clampUnit(value()) * 100)}
              min={0}
              max={100}
              onChange={(next) => editValue(clampUnit(next / 100))}
              format={(next) => `${next}%`}
              keyframe={<Keyframe target={props.effect} property="value" />}
            />
          </ControlRow>
        </Show>

        <Show when={option().unit === "px"}>
          <ControlRow label="Radius" contentClass="grid grid-cols-2 gap-2">
            <ControlledTextField
              value={value()}
              onNumber={(next) => editValue(Math.max(0, next))}
              min={0}
              autoSelect
              sliderEnabled
              limitEvents
              keyframe={<Keyframe target={props.effect} property="value" />}
            />
            <IncrementDecrementControl
              onDecrement={() => editValue(Math.max(0, value() - 1))}
              onIncrement={() => editValue(value() + 1)}
              decrementLabel="Decrease blur radius"
              incrementLabel="Increase blur radius"
            />
          </ControlRow>
        </Show>

        <Show when={option().unit === "deg"}>
          <ControlRow label="Angle">
            <ControlledTextField
              icon={<Icon name="rotate-angle" class="size-6" />}
              value={value()}
              onNumber={editValue}
              unit="deg"
              step={1}
              autoSelect
              sliderEnabled
              limitEvents
              keyframe={<Keyframe target={props.effect} property="value" />}
            />
          </ControlRow>
        </Show>
      </FloatingInspectorContent>
    </FloatingInspector>
  );
}
