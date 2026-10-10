/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createMemo, createSignal } from "solid-js";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectIconTrigger,
  SelectItem,
  SelectPortal,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
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
import { IncrementDecrementControl } from "@/components/ui/increment-decrement-control";
import { SegmentedIconTabs } from "@/components/ui/segmented-icon-tabs";
import { Keyframe } from "@/components/ui/keyframe";
import { useHas, useTrait, useWorld } from "@diffusionstudio/koota-solid";
import { Cache, Computed, StrokeDash, StrokeJoin, StrokeStyle } from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { removeKeyframeTrack, syncKeyframe } from "@/engine/keyframes";
import { FillPicker, type FillTab } from "./fill-picker";

import type { Accessor } from "solid-js";

import type { AnimatableProperty, StrokeJoin as StrokeJoinName } from "@diffusionstudio/jsx";
import type { Entity } from "koota";

const JOIN_SEGMENTS: { value: StrokeJoinName; icon: string; label: string }[] = [
  { value: "miter", icon: "line-join-miter", label: "Miter" },
  { value: "bevel", icon: "line-join-bevel", label: "Bevel" },
  { value: "round", icon: "line-join-round", label: "Round" },
];

type LineStyle = "solid" | "dashed";

const LINE_STYLES: LineStyle[] = ["solid", "dashed"];

const LINE_STYLE_ICONS: Record<LineStyle, string> = {
  solid: "stroke.solid",
  dashed: "stroke.dashed",
};

const LINE_STYLE_LABELS: Record<LineStyle, string> = {
  solid: "Solid",
  dashed: "Dashed",
};

/** The props a dashed line adds, all cleared when it goes back to solid. */
const DASH_PROPS: AnimatableProperty[] = ["dash", "dashGap", "dashOffset"];

/** The dash a solid line takes when it is switched to dashed, its gap the same. */
const DASHED_DASH = 10;

const JOIN_NAMES: Record<StrokeJoin, StrokeJoinName> = {
  [StrokeJoin.MITER]: "miter",
  [StrokeJoin.BEVEL]: "bevel",
  [StrokeJoin.ROUND]: "round",
};

/** A line is drawn with a color or a gradient, never a picture. */
const STROKE_TABS: FillTab[] = ["solid", "gradient"];

/** `<stroke>`'s defaults; a control left at one of these unsets its prop, but the dash ones. */
const DEFAULT_WIDTH = 1;
const DEFAULT_MITER_LIMIT = 10;
const DEFAULT_DASH = 0;
const DEFAULT_DASH_OFFSET = 0;

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
 * One `<stroke>`: its paint and its line style (`width`/`join`/`miterLimit`,
 * and when the style select has it dashed `dash`/`dashGap`/`dashOffset`).
 * The paint is the stroke's own `color` or a
 * gradient paint child, picked in the fill picker without its asset tab; a
 * gradient is placed in the box of the stroke's parent, so that is where its
 * handles go. `cap` has no control yet: there are no icons for it.
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

  const dash = useDerived(() => props.stroke.get(Computed)?.dash ?? DEFAULT_DASH);
  const dashGap = useDerived(() => props.stroke.get(Computed)?.dashGap ?? DEFAULT_DASH);
  const dashOffset = useDerived(() => props.stroke.get(Computed)?.dashOffset ?? DEFAULT_DASH_OFFSET);

  const isDashed = useHas(() => props.stroke, StrokeDash);
  const lineStyle = (): LineStyle => (isDashed() ? "dashed" : "solid");

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

  // The dash fields write even their defaults: unsetting the last of them
  // would make the line solid, and only the style select does that.
  const editDash = (value: number) => {
    editor.editProperty(props.stroke, "dash", value);
    syncKeyframe(world, editor, props.stroke, "dash", value);
  };

  const editDashGap = (value: number) => {
    editor.editProperty(props.stroke, "dashGap", value);
    syncKeyframe(world, editor, props.stroke, "dashGap", value);
  };

  const editDashOffset = (value: number) => {
    editor.editProperty(props.stroke, "dashOffset", value);
    syncKeyframe(world, editor, props.stroke, "dashOffset", value);
  };

  // Solid clears every dash prop and its track.
  const editLineStyle = (value: LineStyle) => {
    if (value === lineStyle()) return;
    if (value === "solid") {
      for (const property of DASH_PROPS) {
        removeKeyframeTrack(world, editor, props.stroke, property);
        editor.editProperty(props.stroke, property, false);
      }
      return;
    }
    editor.editProperty(props.stroke, "dash", DASHED_DASH);
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
        <FloatingInspectorContent class="flex flex-col gap-3 px-2 py-4">
          <div class="flex flex-col gap-2 px-2">
            <ControlRow label="Color">
              <FillItem fill={paint()} onClick={() => setPickingPaint(true)} />
            </ControlRow>

            <ControlRow label="Weight">
              <div class="grid grid-cols-2 gap-2">
                <ControlledTextField
                  icon={<Icon name="stroke.weight" />}
                  value={width()}
                  onNumber={editWidth}
                  step={1}
                  min={0}
                  autoSelect
                  sliderEnabled
                  limitEvents
                  keyframe={<Keyframe target={props.stroke} property="width" />}
                />
                <IncrementDecrementControl
                  onDecrement={() => editWidth(Math.max(0, width() - 1))}
                  onIncrement={() => editWidth(width() + 1)}
                  decrementLabel="Decrease weight"
                  incrementLabel="Increase weight"
                />
              </div>
            </ControlRow>
          </div>

          <Separator />

          <div class="flex flex-col gap-2 px-2">
            <ControlRow label="Style">
              <Select<LineStyle>
                value={lineStyle()}
                onChange={(value) => value && editLineStyle(value)}
                options={LINE_STYLES}
                itemComponent={(itemProps) => (
                  <SelectItem item={itemProps.item} class="gap-1 px-0 pr-2">
                    <span class="flex items-center gap-1">
                      <span class="w-7 h-7 shrink-0 flex items-center justify-center">
                        <Icon
                          name={LINE_STYLE_ICONS[itemProps.item.rawValue]}
                          class="text-popover-foreground group-data-[highlighted]:text-primary-foreground"
                        />
                      </span>
                      <span class="min-w-0 truncate">{LINE_STYLE_LABELS[itemProps.item.rawValue]}</span>
                    </span>
                  </SelectItem>
                )}
              >
                <SelectIconTrigger
                  icon={<Icon name={LINE_STYLE_ICONS[lineStyle()]} />}
                  valueClass="text-xxs flex-1"
                >
                  {LINE_STYLE_LABELS[lineStyle()]}
                </SelectIconTrigger>
                <SelectPortal>
                  <SelectContent class="w-32" />
                </SelectPortal>
              </Select>
            </ControlRow>

            <Show when={lineStyle() === "dashed"}>
              <ControlRow label="Dash">
                <ControlledTextField
                  value={dash()}
                  onNumber={editDash}
                  step={1}
                  min={0}
                  autoSelect
                  limitEvents
                  keyframe={<Keyframe target={props.stroke} property="dash" />}
                />
              </ControlRow>

              <ControlRow label="Gap">
                <ControlledTextField
                  value={dashGap()}
                  onNumber={editDashGap}
                  step={1}
                  min={0}
                  autoSelect
                  limitEvents
                  keyframe={<Keyframe target={props.stroke} property="dashGap" />}
                />
              </ControlRow>

              <ControlRow label="Offset">
                <ControlledTextField
                  value={dashOffset()}
                  onNumber={editDashOffset}
                  step={1}
                  autoSelect
                  limitEvents
                  keyframe={<Keyframe target={props.stroke} property="dashOffset" />}
                />
              </ControlRow>
            </Show>
          </div>

          <Separator />

          <div class="flex flex-col gap-2 px-2">
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
                icon={<Icon name="stroke.miter" />}
                value={miterLimit()}
                onNumber={editMiterLimit}
                step={1}
                min={1}
                autoSelect
                sliderEnabled
                limitEvents
              />
            </ControlRow>
          </div>
        </FloatingInspectorContent>
      </FloatingInspector>

      <Show when={pickingPaint()}>
        <FillPicker
          anchorRef={inspectorRef!}
          node={props.stroke}
          fill={paint()}
          tabs={STROKE_TABS}
          onClose={() => setPickingPaint(false)}
          onReplace={() => { }}
        />
      </Show>
    </>
  );
}
