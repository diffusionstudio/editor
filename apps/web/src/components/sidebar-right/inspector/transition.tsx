/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createMemo, createSignal } from "solid-js";
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
import { ItemRow } from "@/components/ui/item-row";
import { PanelSection } from "@/components/ui/panel-section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SliderInput } from "@/components/ui/slider-input";
import { useHas, useTrait, useWorld } from "@diffusionstudio/koota/solid";
import { FrameRate, Transition, framesToSeconds } from "@diffusionstudio/runtime";
import { useEditor } from "@/engine/hooks";
import {
  DEFAULT_TRANSITION,
  DEFAULT_TRANSITION_DURATION,
  TRANSITION_OPTIONS,
  transitionOption,
} from "./transition-types";

import type { TransitionOption } from "./transition-types";
import type { Entity } from "@diffusionstudio/koota";

type TransitionSettingsProps = {
  selection: Entity[];
};

/**
 * The clip's `transition`: how it comes in from the one before it, rendered
 * centered on the cut. A prop rather than a child element, and one per clip,
 * so the panel is a single row and its plus goes once a transition is there.
 *
 * The prop is written whole, both fields every time. The document merges a
 * partial into the transition already set while the file would spell only
 * what it was handed, so a partial write would leave the two saying
 * different things; a transition is two settings and the panel shows both.
 */
export function TransitionSettings(props: TransitionSettingsProps) {
  const world = useWorld();
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  let anchorRef!: HTMLDivElement;

  const [open, setOpen] = createSignal(false);

  const transition = useTrait(entity, Transition);
  const has = useHas(entity, Transition);
  const frameRate = useTrait(world, FrameRate);

  const option = createMemo(() => transitionOption(transition()?.type));
  const duration = createMemo(() =>
    framesToSeconds(transition()?.duration ?? 0, frameRate()?.value ?? 30),
  );

  const write = (type: TransitionOption, seconds: number) => {
    editor.editProperty(entity(), "transition", { type: type.name, duration: seconds });
  };

  const handleAddTransition = () => {
    write(DEFAULT_TRANSITION, DEFAULT_TRANSITION_DURATION);
    setOpen(true);
  };

  const handleRemoveTransition = () => {
    // `false` is what the writer spells as the attribute's absence; the
    // document reads anything but an object as "no transition".
    editor.editProperty(entity(), "transition", false);
    setOpen(false);
  };

  const handleTypeChange = (next: TransitionOption | null) => {
    if (next === null || next.name === option().name) return;
    write(next, duration());
  };

  const handleDurationChange = (seconds: number) => {
    write(option(), Math.round(seconds * 10) / 10);
  };

  return (
    <>
      <PanelSection
        title="Transition"
        ref={anchorRef}
        actions={
          <Show when={!has()}>
            <Tooltip>
              <TooltipTrigger
                as={Button}
                size="icon"
                variant="ghost"
                class="text-muted-foreground"
                onClick={handleAddTransition}
              >
                <Icon name="plus-add" />
              </TooltipTrigger>
              <TooltipContent>Add transition</TooltipContent>
            </Tooltip>
          </Show>
        }
      >
        <Show when={has()}>
          <ItemRow
            label="Type"
            value={option().label}
            icon={<Icon name="video-transition" />}
            onClick={() => setOpen(true)}
          >
            <Tooltip>
              <TooltipTrigger
                as={Button}
                size="icon"
                variant="ghost"
                class="text-muted-foreground"
                onClick={handleRemoveTransition}
              >
                <Icon name="close-remove-small" />
              </TooltipTrigger>
              <TooltipContent>Remove transition</TooltipContent>
            </Tooltip>
          </ItemRow>
        </Show>
      </PanelSection>

      <Show when={open() && has()}>
        <FloatingInspector open anchorRef={anchorRef} width={248}>
          <FloatingInspectorHeader class="items-center justify-between px-2">
            <Select<TransitionOption>
              value={option()}
              onChange={handleTypeChange}
              options={TRANSITION_OPTIONS}
              optionValue="name"
              optionTextValue="label"
              itemComponent={(itemProps) => (
                <SelectItem item={itemProps.item}>{itemProps.item.rawValue.label}</SelectItem>
              )}
            >
              <SelectTrigger>
                <SelectValue<TransitionOption>>
                  {(state) => state.selectedOption()?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectPortal>
                <SelectContent class="w-44" />
              </SelectPortal>
            </Select>
            <Tooltip>
              <TooltipTrigger
                as={Button}
                size="icon"
                variant="ghost"
                class="text-muted-foreground"
                onClick={() => setOpen(false)}
              >
                <Icon name="close-remove" />
              </TooltipTrigger>
              <TooltipContent>Close</TooltipContent>
            </Tooltip>
          </FloatingInspectorHeader>
          <FloatingInspectorSeparator />
          <FloatingInspectorContent class="p-4">
            <ControlRow label="Duration">
              <SliderInput
                value={duration()}
                onChange={handleDurationChange}
                min={0.1}
                max={10}
                step={0.1}
                format={(value) => `${value.toFixed(1)}s`}
              />
            </ControlRow>
          </FloatingInspectorContent>
        </FloatingInspector>
      </Show>
    </>
  );
}
