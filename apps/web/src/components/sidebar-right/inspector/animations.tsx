/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createMemo, createSignal } from "solid-js";
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
  SelectSection,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SliderInput } from "@/components/ui/slider-input";
import { useTrait, useWorld } from "@diffusionstudio/koota/solid";
import { Animation as AnimationElement } from "@diffusionstudio/reconciler";
import {
  Animation,
  AnimationPhase,
  Cache,
  FrameRate,
  Paint,
  PaintType,
  framesToSeconds,
  getIntrinsicPaint,
  isAudio,
  isText,
} from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { ANIMATION_GROUPS, DEFAULT_ANIMATION, animationOption } from "./animation-types";

import type { AnimationGroup, AnimationOption } from "./animation-types";
import type { Entity } from "@diffusionstudio/koota";

/** `<animation>`'s defaults; a control left at one of these unsets its prop. */
const DEFAULT_DURATION = 1;
const DEFAULT_DELAY = 0;

// Stable identity, so a node without animations does not resample every tick.
const NO_ANIMATIONS: Entity[] = [];

const phaseRank = (animation: Entity) =>
  animation.get(Animation)?.phase === AnimationPhase.OUT ? 1 : 0;

const sameOrder = (a: Entity[], b: Entity[]) =>
  a.length === b.length && a.every((entity, index) => entity === b[index]);

type AnimationsSettingsProps = {
  selection: Entity[];
};

/**
 * The `<animation>` children of the selected node: the presets it plays over
 * its head and tail. Rows are the ones playing in first and the ones playing
 * out after, each in the file's order, which is the order they write in when
 * two of them drive the same property.
 *
 * The plus authors a fade rather than asking which preset first: every
 * animation is the same three settings under a different name, so which one
 * it is, is a control in the inspector like the others.
 */
export function AnimationsSettings(props: AnimationsSettingsProps) {
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  let anchorRef!: HTMLDivElement;

  const [picked, setPicked] = createSignal<Entity>();

  // Cache is derived state, written without change events.
  const animations = useDerived(() => {
    const list = entity().get(Cache)?.animations ?? NO_ANIMATIONS;
    // Sorting is stable, so the file's order survives within each phase.
    return list.length < 2 ? list : [...list].sort((a, b) => phaseRank(a) - phaseRank(b));
  }, sameOrder);

  const handleAppendAnimation = () => {
    const [animation] = editor.insertElement(entity(), () => (
      <AnimationElement type={DEFAULT_ANIMATION.name} />
    ));
    // Which preset it is, is the one thing the default cannot answer, so the
    // inspector opens on the new animation for it to be said.
    if (animation) setPicked(animation);
  };

  // Read back off the list, so removing an animation closes the inspector on it.
  const editing = createMemo(() => {
    const animation = picked();
    return animation !== undefined && animations().includes(animation) ? animation : undefined;
  });

  return (
    <>
      <PanelSection
        title="Animations"
        ref={anchorRef}
        actions={
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={handleAppendAnimation}
            >
              <Icon name="plus-add" />
            </TooltipTrigger>
            <TooltipContent>Add animation</TooltipContent>
          </Tooltip>
        }
      >
        <For each={animations()}>
          {(animation) => (
            <AnimationRow
              animation={animation}
              onSelect={() => setPicked(animation)}
              onRemove={() => editor.remove(animation)}
            />
          )}
        </For>
      </PanelSection>

      <Show when={editing() !== undefined}>
        <AnimationInspector
          animation={editing()!}
          node={entity()}
          anchorRef={anchorRef}
          onClose={() => setPicked(undefined)}
        />
      </Show>
    </>
  );
}

type AnimationRowProps = {
  animation: Entity;
  onSelect(): void;
  onRemove(): void;
};

function AnimationRow(props: AnimationRowProps) {
  const animation = useTrait(() => props.animation, Animation);

  const label = createMemo(() => animationOption(animation()?.type).label);
  const phase = createMemo(() => (animation()?.phase === AnimationPhase.OUT ? "OUT" : "IN"));

  return (
    <ItemRow
      label={phase()}
      value={label()}
      icon={<Icon name="preferences-adjust" />}
      onClick={props.onSelect}
    >
      <Tooltip>
        <TooltipTrigger
          as={Button}
          size="icon"
          variant="ghost"
          class="text-muted-foreground"
          onClick={props.onRemove}
        >
          <Icon name="close-remove-small" />
        </TooltipTrigger>
        <TooltipContent>Remove animation</TooltipContent>
      </Tooltip>
    </ItemRow>
  );
}

/** Whether `node` has anything to hear, which is what a gain animates. */
function hasAudio(node: Entity): boolean {
  if (isAudio(node) || getIntrinsicPaint(node) === PaintType.VIDEO) return true;
  return (node.get(Cache)?.fills ?? []).some((fill) => fill.get(Paint)?.value === PaintType.VIDEO);
}

type AnimationInspectorProps = {
  animation: Entity;
  node: Entity;
  anchorRef: HTMLElement;
  onClose(): void;
};

/**
 * One `<animation>`: which preset it is (the select in the header, where a
 * title would be), whether it plays in or out, how long it takes and how
 * long after the clip edge it starts. `type` is required and always written;
 * the other three unset at their defaults.
 */
function AnimationInspector(props: AnimationInspectorProps) {
  const world = useWorld();
  const editor = useEditor();

  const animation = useTrait(() => props.animation, Animation);
  const frameRate = useTrait(world, FrameRate);

  const option = createMemo(() => animationOption(animation()?.type));
  const fps = () => frameRate()?.value ?? 30;
  const duration = createMemo(() => framesToSeconds(animation()?.duration ?? 0, fps()));
  const delay = createMemo(() => framesToSeconds(animation()?.delay ?? 0, fps()));
  const isOut = createMemo(() => animation()?.phase === AnimationPhase.OUT);

  /**
   * The groups this node can play, plus whichever one holds the current
   * preset: a `gain` authored on a node that has since lost its audio still
   * has to be shown, or the select would have no value to display.
   */
  const groups = createMemo(() =>
    ANIMATION_GROUPS.filter(
      (group) =>
        group.kind === undefined ||
        (group.kind === "text" ? isText(props.node) : hasAudio(props.node)) ||
        group.options.includes(option()),
    ),
  );

  const handleTypeChange = (next: AnimationOption | null) => {
    if (next === null || next.name === option().name) return;
    editor.editProperty(props.animation, "type", next.name);
  };

  const handlePhaseChange = (next: boolean) => {
    editor.editProperty(props.animation, "phase", next ? "out" : false);
  };

  const handleDurationChange = (seconds: number) => {
    const next = Math.round(seconds * 10) / 10;
    editor.editProperty(props.animation, "duration", next === DEFAULT_DURATION ? false : next);
  };

  const handleDelayChange = (seconds: number) => {
    const next = Math.round(seconds * 10) / 10;
    editor.editProperty(props.animation, "delay", next === DEFAULT_DELAY ? false : next);
  };

  return (
    <FloatingInspector open anchorRef={props.anchorRef} width={248}>
      <FloatingInspectorHeader class="items-center justify-between px-2">
        <Select<AnimationOption, AnimationGroup>
          value={option()}
          onChange={handleTypeChange}
          options={groups()}
          optionValue="name"
          optionTextValue="label"
          optionGroupChildren="options"
          itemComponent={(itemProps) => (
            <SelectItem item={itemProps.item}>{itemProps.item.rawValue.label}</SelectItem>
          )}
          sectionComponent={(sectionProps) => (
            <SelectSection>{sectionProps.section.rawValue.label}</SelectSection>
          )}
        >
          <SelectTrigger>
            <SelectValue<AnimationOption>>
              {(state) => state.selectedOption()?.label}
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
            onClick={props.onClose}
          >
            <Icon name="close-remove" />
          </TooltipTrigger>
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
      </FloatingInspectorHeader>
      <FloatingInspectorSeparator />
      <FloatingInspectorContent class="flex flex-col gap-2 p-4">
        <ControlRow label="Phase">
          <Select<boolean>
            value={isOut()}
            onChange={(value) => value !== null && handlePhaseChange(value)}
            options={[false, true]}
            itemComponent={(itemProps) => (
              <SelectItem item={itemProps.item}>
                {itemProps.item.rawValue ? "Out" : "In"}
              </SelectItem>
            )}
          >
            <SelectTrigger>
              <SelectValue class="text-xs">{isOut() ? "Out" : "In"}</SelectValue>
            </SelectTrigger>
            <SelectPortal>
              <SelectContent />
            </SelectPortal>
          </Select>
        </ControlRow>

        <ControlRow label="Duration">
          <SliderInput
            value={duration()}
            onChange={handleDurationChange}
            min={0.1}
            max={5}
            step={0.1}
            format={(value) => `${value.toFixed(1)}s`}
          />
        </ControlRow>

        <ControlRow label="Delay">
          <SliderInput
            value={delay()}
            onChange={handleDelayChange}
            min={0}
            max={5}
            step={0.1}
            format={(value) => `${value.toFixed(1)}s`}
          />
        </ControlRow>
      </FloatingInspectorContent>
    </FloatingInspector>
  );
}
