/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createMemo, createSignal } from "solid-js";
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
import { FillItem } from "@/components/ui/fill-item";
import { ControlledTextField } from "@/components/ui/text-field";
import { SegmentedIconTabs } from "@/components/ui/segmented-icon-tabs";
import { Keyframe } from "@/components/ui/keyframe";
import { useTrait, useWorld } from "@diffusionstudio/koota-solid";
import { Cache, Computed, StrokeJoin, StrokeStyle } from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { syncKeyframe } from "@/engine/keyframes";
import { FillPicker, type FillTab } from "./fill-picker";

import type { Accessor } from "solid-js";

import type { StrokeJoin as StrokeJoinName } from "@diffusionstudio/jsx";
import type { Entity } from "koota";

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

/** A line is drawn with a color or a gradient, never a picture. */
const STROKE_TABS: FillTab[] = ["solid", "gradient"];

/** `<stroke>`'s defaults; a control left at one of these unsets its prop. */
const DEFAULT_WIDTH = 1;
const DEFAULT_MITER_LIMIT = 10;

// Stable identity, so a stroke without paint children does not resample every tick.
const NO_PAINTS: Entity[] = [];

/**
 * The paint the inspector shows for `stroke`: its topmost paint child, or,
 * without one, the stroke itself, whose `color` is its own solid paint. A
 * stroke stacking several paint children is edited through its top one.
 */
export function useStrokePaint(stroke: Accessor<Entity>): Accessor<Entity> {
  // Cache is derived state, written without change events.
  const paints = useDerived(() => stroke().get(Cache)?.fills ?? NO_PAINTS);
  return createMemo(() => paints().at(-1) ?? stroke());
}

type StrokeInspectorProps = {
  stroke: Entity;
  anchorRef: HTMLElement;
  onClose(): void;
};

/**
 * One `<stroke>`: its paint and its line style (`width`/`join`/`miterLimit`).
 * The paint is the stroke's own `color` or a gradient paint child, picked in
 * the fill picker without its asset tab; a gradient is placed in the box of
 * the stroke's parent, so that is where its handles go. `cap` has no control
 * yet: it only shows on open paths (text glyphs) and there are no icons for it.
 */
export function StrokeInspector(props: StrokeInspectorProps) {
  const world = useWorld();
  const editor = useEditor();

  let inspectorRef: HTMLDivElement | undefined;

  const [pickingPaint, setPickingPaint] = createSignal(false);

  const paint = useStrokePaint(() => props.stroke);
  const width = useDerived(() => props.stroke.get(Computed)?.strokeWidth ?? DEFAULT_WIDTH);

  const style = useTrait(() => props.stroke, StrokeStyle);

  const join = createMemo(() => JOIN_NAMES[style()?.join ?? StrokeJoin.MITER]);
  const miterLimit = () => style()?.miterLimit ?? DEFAULT_MITER_LIMIT;

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
    setPickingPaint(false);
    props.onClose();
  };

  return (
    <>
      <FloatingInspector open anchorRef={props.anchorRef} width={248} ref={inspectorRef} onClose={handleClose}>
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
          <ControlRow label="Paint">
            <FillItem fill={paint()} onClick={() => setPickingPaint(true)} />
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

      <Show when={pickingPaint()}>
        <FillPicker
          anchorRef={inspectorRef!}
          node={props.stroke}
          fill={paint()}
          tabs={STROKE_TABS}
          onClose={() => setPickingPaint(false)}
          onReplace={() => {}}
        />
      </Show>
    </>
  );
}
