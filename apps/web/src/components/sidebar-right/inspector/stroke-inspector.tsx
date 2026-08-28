/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, createSignal } from "solid-js";
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
import { SegmentedIconTabs } from "@/components/ui/segmented-icon-tabs";
import { Keyframe } from "@/components/ui/keyframe";
import { useTrait, useWorld } from "@diffusionstudio/koota-solid";
import { Computed, StrokeJoin, StrokeStyle, colorToHex } from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { syncKeyframe } from "@/engine/keyframes";

import type { StrokeJoin as StrokeJoinName } from "@diffusionstudio/jsx";
import type { Entity } from "@diffusionstudio/koota";

const JOIN_SEGMENTS: { value: StrokeJoinName; icon: string; label: string }[] = [
  { value: "miter", icon: "line-join-miter", label: "Miter" },
  { value: "bevel", icon: "line-join-bevel", label: "Bevel" },
  { value: "round", icon: "line-join-round", label: "Round" },
];

const JOIN_NAMES: Record<StrokeJoin, StrokeJoinName> = {
  [StrokeJoin.MITER]: "miter",
  [StrokeJoin.BEVEL]: "bevel",
  [StrokeJoin.ROUND]: "round",
};

/** `<stroke>`'s defaults; a control left at one of these unsets its prop. */
const DEFAULT_OPACITY = 1;
const DEFAULT_WIDTH = 1;
const DEFAULT_MITER_LIMIT = 10;

type StrokeInspectorProps = {
  stroke: Entity;
  anchorRef: HTMLElement;
  onClose(): void;
};

/**
 * One `<stroke>`: its paint (color and opacity) and its line style
 * (`width`/`join`/`miterLimit`). A stroke is a solid color and takes no paint
 * children, so the color half is the color picker alone, with no gradient or
 * asset tab. `cap` has no control yet: it only shows on open paths (text
 * glyphs) and there are no icons for it.
 */
export function StrokeInspector(props: StrokeInspectorProps) {
  const world = useWorld();
  const editor = useEditor();

  let colorRowRef: HTMLDivElement | undefined;

  const [pickingColor, setPickingColor] = createSignal(false);

  const color = useDerived(() => props.stroke.get(Computed)?.color ?? 0);
  const opacity = useDerived(() => props.stroke.get(Computed)?.opacity ?? DEFAULT_OPACITY);
  const width = useDerived(() => props.stroke.get(Computed)?.strokeWidth ?? DEFAULT_WIDTH);

  const style = useTrait(() => props.stroke, StrokeStyle);

  const join = createMemo(() => JOIN_NAMES[style()?.join ?? StrokeJoin.MITER]);
  const miterLimit = () => style()?.miterLimit ?? DEFAULT_MITER_LIMIT;

  /** A stroke's color is required, never unset. */
  const editColor = (value: number) => {
    const hex = colorToHex(value);
    editor.editProperty(props.stroke, "color", hex);
    syncKeyframe(world, editor, props.stroke, "color", hex);
  };

  const editOpacity = (value: number) => {
    const next = Math.round(value * 100) / 100;
    editor.editProperty(props.stroke, "opacity", next === DEFAULT_OPACITY ? false : next);
    syncKeyframe(world, editor, props.stroke, "opacity", next);
  };

  const editWidth = (value: number) => {
    // Unlike a node's width this is the line width, not `resizeEntity`, so
    // there is no track of its own to mint and the sync belongs after.
    editor.editProperty(props.stroke, "width", value === DEFAULT_WIDTH ? false : value);
    syncKeyframe(world, editor, props.stroke, "width", value);
  };

  const editJoin = (value: StrokeJoinName) => {
    editor.editProperty(props.stroke, "join", value === "miter" ? false : value);
  };

  const editMiterLimit = (value: number) => {
    editor.editProperty(
      props.stroke,
      "miterLimit",
      value === DEFAULT_MITER_LIMIT ? false : value,
    );
  };

  const handleClose = () => {
    setPickingColor(false);
    props.onClose();
  };

  return (
    <>
      <FloatingInspector open anchorRef={props.anchorRef} width={248}>
        <FloatingInspectorHeader class="items-center justify-between">
          <FloatingInspectorTitle>Stroke</FloatingInspectorTitle>
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
              keyframe={<Keyframe target={props.stroke} property="opacity" />}
            />
          </ControlRow>

          <ControlRow label="Weight">
            <ControlledTextField
              value={width()}
              onNumber={editWidth}
              step={1}
              min={0}
              autoSelect
              limitEvents
              keyframe={<Keyframe target={props.stroke} property="width" />}
            />
          </ControlRow>

          <ControlRow label="Join">
            <SegmentedIconTabs
              value={join}
              onChange={editJoin}
              items={JOIN_SEGMENTS}
              buttonClass="transition-colors"
              iconClass="size-3.5 text-muted-foreground"
            />
          </ControlRow>

          <ControlRow label="Miter">
            <ControlledTextField
              value={miterLimit()}
              onNumber={editMiterLimit}
              step={1}
              min={1}
              autoSelect
              limitEvents
            />
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
            keyframeTarget={props.stroke}
          />
        </FloatingInspectorContent>
      </FloatingInspector>
    </>
  );
}
