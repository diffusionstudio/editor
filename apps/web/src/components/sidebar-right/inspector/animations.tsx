/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { IconButton } from "@/components/ui/icon-button";
import { ControlRow } from "@/components/ui/control-group";
import {
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MenuIconButton } from "@/components/ui/menu-icon-button";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorSeparator,
  FloatingInspectorTitle,
  FloatingInspectorLayer,
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
import { For, Show, createMemo, createUniqueId } from "solid-js";

import { useEntityState, AnimationType, AnimationPhase, PaintType, createEntity, deleteEntity, isAudio, isText, appendChild, setComponent } from "@/components/engine";
import { useEngine } from "@/context/engine";
import { secondsToFrames } from "@/components/engine/utils/time";
import { useActiveInspector, useActiveInspectorInvalidation } from "./active-inspector";


type AnimationsSettingsProps = {
  selection: Set<number>;
};

const ANIMATION_LABELS: Record<AnimationType, string> = {
  [AnimationType.FADE]: "Fade",
  [AnimationType.GAIN]: "Volume",
  [AnimationType.GROW]: "Grow",
  [AnimationType.SHRINK]: "Shrink",
  [AnimationType.BLUR]: "Blur",
  [AnimationType.SLIDE_LEFT]: "Slide left",
  [AnimationType.SLIDE_RIGHT]: "Slide right",
  [AnimationType.SLIDE_UP]: "Slide up",
  [AnimationType.SLIDE_DOWN]: "Slide down",
  [AnimationType.SPIN]: "Spin",
  [AnimationType.TWIST]: "Twist",
  [AnimationType.APPEAR_WORD]: "Appear word",
  [AnimationType.APPEAR_CHAR]: "Appear character",
  [AnimationType.SCRAMBLE]: "Scramble",
};

type AnimationGroupKind = "text" | "audio";

const ANIMATION_GROUPS: Array<{ label: string; types: AnimationType[]; kind?: AnimationGroupKind }> = [
  {
    label: "Fade",
    types: [
      AnimationType.FADE,
      AnimationType.SLIDE_LEFT,
      AnimationType.SLIDE_RIGHT,
      AnimationType.SLIDE_UP,
      AnimationType.SLIDE_DOWN,
    ],
  },
  {
    label: "Scale",
    types: [
      AnimationType.GROW,
      AnimationType.SHRINK,
      AnimationType.SPIN,
      AnimationType.TWIST,
    ],
  },
  {
    label: "Blur",
    types: [AnimationType.BLUR],
  },
  {
    label: "Text",
    kind: "text",
    types: [
      AnimationType.APPEAR_WORD,
      AnimationType.APPEAR_CHAR,
      AnimationType.SCRAMBLE,
    ],
  },
  {
    label: "Audio",
    kind: "audio",
    types: [AnimationType.GAIN],
  },
];

type AnimationRowProps = {
  animEid: number;
  onInspect(): void;
  onRemove(): void;
};

function AnimationRow(props: AnimationRowProps) {
  const { world } = useEngine();
  const c = world.components;

  const animationType = useEntityState(c.Animation.type, props.animEid, 0);
  const animationPhase = useEntityState(c.Animation.phase, props.animEid, 0);

  const label = createMemo(() => ANIMATION_LABELS[animationType() as AnimationType]);
  const phaseLabel = createMemo(() => animationPhase() === AnimationPhase.OUT ? "OUT" : "IN");

  return (
    <ItemRow
      value={label()}
      label={phaseLabel()}
      icon={<Icon name="preferences-adjust" />}
      onClick={props.onInspect}
    >
      <IconButton
        tooltip="Remove animation"
        aria-label="Remove animation"
        class="text-muted-foreground"
        onClick={props.onRemove}
      >
        <Icon name="close-remove-small" />
      </IconButton>
    </ItemRow>
  );
}

const OWNER = "animation";

export function AnimationsSettings(props: AnimationsSettingsProps) {
  const { world } = useEngine();
  const c = world.components;

  const titleId = createUniqueId();
  const inspectors = useActiveInspector();
  const inspectingAnimation = () => inspectors.currentId(OWNER);

  let inspectorAnchorRef: HTMLDivElement | undefined;
  let sectionRef: HTMLDivElement | undefined;

  const eid = () => props.selection.values().next().value!;
  const animations = useEntityState(c.Cache.animations, eid, []);
  const fillEids = useEntityState(c.Cache.fills, eid, [] as number[]);
  useActiveInspectorInvalidation(OWNER, animations);

  const availableGroups = createMemo(() => {
    // Captions are also text-geometry, so isText covers both.
    const isTextNode = isText(world, eid());
    const isAudioNode = isAudio(world, eid());
    const hasVideoFill = fillEids().some(fid => c.Paint[fid] === PaintType.VIDEO);
    const hasAudio = isAudioNode || hasVideoFill;

    return ANIMATION_GROUPS.filter(group => {
      if (group.kind === "text") return isTextNode;
      if (group.kind === "audio") return hasAudio;
      return true;
    });
  });

  const inAnimEids = createMemo(() =>
    animations().filter(animEid => c.Animation.phase[animEid] !== AnimationPhase.OUT)
  );
  const outAnimEids = createMemo(() =>
    animations().filter(animEid => c.Animation.phase[animEid] === AnimationPhase.OUT)
  );

  const handleAddAnimation = (type: AnimationType) => {
    const newAnimEid = world.history.transaction('Add animation', () => {
      const animEid = createEntity(world);
      setComponent(world, animEid, c.Animation, {
        duration: world.frameRate,
        type,
        phase: AnimationPhase.IN,
      });
      appendChild(world, animEid, eid());
      return animEid;
    });
    inspectors.open(OWNER, newAnimEid);
  };

  const handleRemoveAnimation = (aid: number) => deleteEntity(world, aid);
  const handleInspectAnimation = (aid: number) => inspectors.toggle(OWNER, aid);

  // Read inspected animation's data reactively
  const inspectedPhase = useEntityState(c.Animation.phase, inspectingAnimation, 0);
  const inspectedDuration = useEntityState(c.Animation.duration, inspectingAnimation, world.frameRate);
  const inspectedDurationInSeconds = createMemo(() => inspectedDuration() / world.frameRate);
  const inspectedDelay = useEntityState(c.Animation.delay, inspectingAnimation, 0);
  const inspectedDelayInSeconds = createMemo(() => inspectedDelay() / world.frameRate);

  const handleDurationChange = (durationSec: number) => {
    const eid = inspectingAnimation();
    if (!eid) return;
    setComponent(world, eid, c.Animation, { duration: secondsToFrames(durationSec) });
  };

  const handleDelayChange = (delaySec: number) => {
    const eid = inspectingAnimation();
    if (!eid) return;
    setComponent(world, eid, c.Animation, { delay: secondsToFrames(delaySec) });
  };

  const handlePhaseChange = (phase: AnimationPhase) => {
    const eid = inspectingAnimation();
    if (!eid) return;
    setComponent(world, eid, c.Animation, { phase });
  };

  return (
    <>
      <div ref={sectionRef} class="contents">
      <PanelSection
        title="Animations"
        ref={inspectorAnchorRef}
        actions={
          <MenuIconButton
            tooltip="Add animation"
            aria-label="Add animation"
            placement="bottom-end"
            modal
            class="text-muted-foreground"
            data-row-control=""
            icon={<Icon name="plus-add" />}
          >
            <For each={availableGroups()}>
              {(group, index) => (
                <>
                  <Show when={index() > 0}>
                    <DropdownMenuSeparator />
                  </Show>
                  <DropdownMenuGroup>
                    <DropdownMenuGroupLabel>{group.label}</DropdownMenuGroupLabel>
                    <For each={group.types}>
                      {(type) => (
                        <DropdownMenuItem onSelect={() => handleAddAnimation(type)}>
                          {ANIMATION_LABELS[type]}
                        </DropdownMenuItem>
                      )}
                    </For>
                  </DropdownMenuGroup>
                </>
              )}
            </For>
          </MenuIconButton>
        }
      >
        <Show when={inAnimEids().length + outAnimEids().length > 0}>
          <div class="contents">
            <For each={inAnimEids().toReversed()}>
              {(animEid) => (
                <AnimationRow
                  animEid={animEid}
                  onInspect={() => handleInspectAnimation(animEid)}
                  onRemove={() => handleRemoveAnimation(animEid)}
                />
              )}
            </For>

            <For each={outAnimEids().toReversed()}>
              {(animEid) => (
                <AnimationRow
                  animEid={animEid}
                  onInspect={() => handleInspectAnimation(animEid)}
                  onRemove={() => handleRemoveAnimation(animEid)}
                />
              )}
            </For>
          </div>
        </Show>
      </PanelSection>
      </div>

      <Show when={inspectingAnimation()}>
        <FloatingInspectorLayer
          onDismiss={() => inspectors.close(OWNER)}
          triggerRef={sectionRef}
          triggerControlSelector="[data-row-control]"
          labelledBy={titleId}
        >
        <FloatingInspector open anchorRef={inspectorAnchorRef} width={248}>
          <FloatingInspectorTitle id={titleId} class="sr-only">Animation</FloatingInspectorTitle>
          <FloatingInspectorHeader class="items-center justify-between px-2">
            <Select
              value={inspectedPhase()}
              options={[AnimationPhase.IN, AnimationPhase.OUT]}
              onChange={(value) => value !== null && handlePhaseChange(value)}
              itemComponent={(itemProps) => (
                <SelectItem item={itemProps.item}>
                  {itemProps.item.rawValue === AnimationPhase.OUT ? "Out" : "In"}
                </SelectItem>
              )}
            >
              <SelectTrigger>
                <SelectValue>
                  {inspectedPhase() === AnimationPhase.OUT ? "Out" : "In"}
                </SelectValue>
              </SelectTrigger>
              <SelectPortal>
                <SelectContent />
              </SelectPortal>
            </Select>
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

          <FloatingInspectorContent class="p-4 gap-2 flex flex-col">
            <ControlRow label="Duration">
              <SliderInput
                value={inspectedDurationInSeconds()}
                onChange={handleDurationChange}
                min={0.1}
                max={5}
                step={0.1}
                format={(v) => `${v.toFixed(1)}s`}
                onDragStart={() => world.history.startTransaction("Edit animation duration")}
                onDragEnd={() => world.history.commitTransaction()}
              />
            </ControlRow>
            <ControlRow label="Delay">
              <SliderInput
                value={inspectedDelayInSeconds()}
                onChange={handleDelayChange}
                min={0}
                max={5}
                step={0.1}
                format={(v) => `${v.toFixed(1)}s`}
                onDragStart={() => world.history.startTransaction("Edit animation delay")}
                onDragEnd={() => world.history.commitTransaction()}
              />
            </ControlRow>
          </FloatingInspectorContent>
        </FloatingInspector>
        </FloatingInspectorLayer>
      </Show>
    </>
  );
}
