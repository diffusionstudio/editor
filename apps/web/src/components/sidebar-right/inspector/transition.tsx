/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ControlRow } from "@/components/ui/control-group";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { MenuIconButton } from "@/components/ui/menu-icon-button";
import {
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorSeparator,
  FloatingInspectorTitle,
} from "@/components/ui/floating-inspector";
import { Icon } from "@/components/ui/icon";
import { ItemRow } from "@/components/ui/item-row";
import { PanelSection } from "@/components/ui/panel-section";
import { SliderInput } from "@/components/ui/slider-input";
import { For, Show, createMemo, createUniqueId } from "solid-js";

import { useEntityState, useEntityTag, TransitionType, removeComponent, setComponent } from "@/components/engine";
import { useEngine } from "@/context/engine";
import { useActiveInspector, useActiveInspectorInvalidation, type InspectorSession } from "./active-inspector";
import { secondsToFrames } from "@/components/engine/utils/time";


type TransitionSettingsProps = {
  selection: Set<number>;
};

const TRANSITION_OPTIONS = Object.values(TransitionType).filter(
  (v): v is TransitionType => typeof v === "number",
);

const TRANSITION_LABELS: Record<TransitionType, string> = {
  [TransitionType.DISSOLVE]: "Dissolve",
  [TransitionType.SLIDE_FROM_RIGHT]: "Slide From Right",
  [TransitionType.SLIDE_FROM_LEFT]: "Slide From Left",
  [TransitionType.FADE_TO_BLACK]: "Fade To Black",
  [TransitionType.FADE_TO_WHITE]: "Fade To White",
};

const OWNER = "transition";

export function TransitionSettings(props: TransitionSettingsProps) {
  const { world } = useEngine();

  const titleId = createUniqueId();
  const inspectors = useActiveInspector();

  const c = world.components;
  let anchorRef: HTMLDivElement | undefined;
  let sectionRef: HTMLDivElement | undefined;

  const eid = () => props.selection.values().next().value!;

  const hasTransition = useEntityTag(c.Transition, eid);
  const transitionType = useEntityState(c.Transition.type, eid, TransitionType.DISSOLVE);
  const transitionDuration = useEntityState(c.Transition.duration, eid, world.frameRate);
  const transitionDurationInSeconds = createMemo(() => transitionDuration() / world.frameRate);

  // Close the inspector if the transition disappears (remove, undo). The one-element
  // list gives the shared helper its confirmedId tolerance so open-on-add (the tag
  // syncs a tick later) doesn't immediately self-close.
  useActiveInspectorInvalidation(OWNER, () => (hasTransition() ? [eid()] : []));

  const transitionLabel = createMemo(() => {
    if (!hasTransition()) return "";
    return TRANSITION_LABELS[transitionType() as TransitionType] ?? "Dissolve";
  });

  const transitionSession = (): InspectorSession => ({
    owner: OWNER,
    id: eid(),
    ownerNodeEid: eid(),
    anchorEl: anchorRef ?? null,
    width: 248,
    labelledBy: titleId,
    render: () => (
      <>
        <FloatingInspectorHeader class="items-center justify-between">
          <FloatingInspectorTitle id={titleId}>{transitionLabel()}</FloatingInspectorTitle>
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={() => inspectors.close(OWNER)}
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
              value={transitionDurationInSeconds()}
              min={0.1}
              max={10}
              step={0.1}
              format={(v) => `${v.toFixed(1)}s`}
              onDragStart={() => world.history.startTransaction("Edit transition duration")}
              onDragEnd={() => world.history.commitTransaction()}
              onChange={handleSetDuration}
            />
          </ControlRow>
        </FloatingInspectorContent>
      </>
    ),
  });

  const handleSetTransition = (type: TransitionType) => {
    setComponent(world, eid(), c.Transition, {
      duration: world.frameRate,
      type,
    });
    inspectors.open(transitionSession());
  };

  const handleRemoveTransition = () => {
    removeComponent(world, eid(), c.Transition);
    inspectors.close(OWNER);
  };

  const handleSetDuration = (durationSec: number) => {
    setComponent(world, eid(), c.Transition, {
      duration: secondsToFrames(durationSec),
    });
  };

  const openInspector = () => {
    if (!hasTransition()) return;
    inspectors.toggle(transitionSession());
  };

  return (
    <>
      <div ref={sectionRef} class="contents">
      <PanelSection
        title="Transition"
        ref={anchorRef}
        actions={
          <MenuIconButton
            tooltip="Add transition"
            aria-label="Add transition"
            placement="bottom-end"
            class="text-muted-foreground"
            data-row-control=""
            disabled={!eid()}
            icon={<Icon name="plus-add" />}
            contentClass="w-44"
          >
                <For each={TRANSITION_OPTIONS}>
                  {(type) => (
                    <DropdownMenuItem onSelect={() => handleSetTransition(type)}>
                      {TRANSITION_LABELS[type]}
                    </DropdownMenuItem>
                  )}
                </For>
          </MenuIconButton>
        }
      >
        <Show when={hasTransition()}>
          <ItemRow
            label="Type"
            value={transitionLabel()}
            icon={<Icon name="video-transition" />}
            onClick={() => openInspector()}
            handoff
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
      </div>
    </>
  );
}
