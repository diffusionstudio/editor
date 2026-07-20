/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSXElement } from "solid-js";

import { Icon } from "@/components/ui/icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ControlledTextField } from "@/components/ui/text-field";
import { Keyframe } from "@/components/ui/keyframe";
import { OpacitySwatch } from "@/components/ui/opacity-swatch";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorTitle,
  FloatingInspectorLayer,
} from "@/components/ui/floating-inspector";
import { useDrag } from "@/hooks/use-drag";
import { clamp, mergeColorWithOpacity } from "@/utils";
import { colorToHex, parseColor } from "@/utils/color";
import { ColorOpacityPicker } from "@/components/ui/color-opacity-picker";
import { ChildOf, PaintType, getParentEntity, useEntityState, useEntityStates, useQuery, createEntity, deleteEntity, appendChild, setComponent } from "@/components/engine";
import { useEngine } from "@/context/engine";
import { Not, entityExists, hasComponent } from 'bitecs';

export type GradientPickerProps = {
  nodeEid: number;
  fillEid: number;
};

const GRADIENT_STYLE_OPTIONS = ["Linear", "Radial"] as const;
type GradientStyleOption = (typeof GRADIENT_STYLE_OPTIONS)[number];

function handleInitialInputPointerDown(e: PointerEvent & { currentTarget: HTMLInputElement }) {
  if (document.activeElement === e.currentTarget) return;
  e.preventDefault();
  e.currentTarget.focus();
  e.currentTarget.select();
};

function getSliderRatio(
  element: HTMLDivElement | undefined,
  pos: { x: number; y: number },
) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width) return null;
  return Math.round(clamp((pos.x - rect.left) / rect.width, 0, 1) * 100) / 100;
};

// Visual position of a stop on the track in [0, 1]. Offsets in [0, 1] map
// directly so the right edge stays at 100%; offsets > 1 wrap so cycling
// animations show the wrapped position.
function visualOffset(raw: number): number {
  if (raw <= 1) return Math.max(0, raw);
  return raw % 1;
}

function isPrimaryPointerButton(e: PointerEvent) {
  return e.button === 0 && !e.ctrlKey;
}

export function GradientFillPicker(props: GradientPickerProps) {
  const { world } = useEngine();
  const c = world.components;

  let rootRef: HTMLDivElement | undefined;
  let stopTrackRef: HTMLDivElement | undefined;

  const [selectedStopEid, setSelectedStopEid] = createSignal<number | null>(null);
  const [colorPickerStopEid, setColorPickerStopEid] = createSignal<number | null>(null);

  const stopEids = useQuery([c.ColorStop, ChildOf(props.fillEid), Not(c.Deleted)]);
  const offsets = useEntityStates(c.Computed.stopOffset, stopEids, 0);
  const colors = useEntityStates(c.Computed.stopColor, stopEids, 0xFFFFFF);
  const opacities = useEntityStates(c.Computed.stopOpacity, stopEids, 1);

  const stops = createMemo(() => stopEids()
    .map((eid, idx) => ({
      eid,
      offset: offsets()[idx],
      color: colors()[idx],
      opacity: opacities()[idx],
    }))
    .toSorted((a, b) => a.offset - b.offset)
  );

  // Key <For> rows by eid; the fresh objects from stops() remount every row on any value change.
  const sortedStopEids = createMemo(() => stops().map((stop) => stop.eid));
  const stopByEidMap = createMemo(() => new Map(stops().map((stop) => [stop.eid, stop])));
  const stopByEid = (eid: number) => stopByEidMap().get(eid);

  const rotation = useEntityState(c.Computed.rotation, props.fillEid, 0);
  const fillType = useEntityState(c.Paint, props.fillEid, PaintType.LINEAR_GRADIENT);

  const addStop = () => {
    const current = stops();
    const first = current[0];
    const second = current[1];

    const newPosition = 0;
    const adjustedFirstPosition = second
      ? clamp((second.offset ?? 0) / 2, 0, 1)
      : clamp((first?.offset ?? 0) / 2, 0, 1);

    const stopEid = world.history.transaction('Add gradient stop', () => {
      if (first) {
        setComponent(world, first.eid, c.ColorStop, { offset: adjustedFirstPosition });
      }

      const newStopEid = createEntity(world);
      setComponent(world, newStopEid, c.ColorStop, {
        offset: newPosition,
        color: first?.color ?? 0xFFFFFF,
        opacity: first?.opacity ?? 1,
      });
      appendChild(world, newStopEid, props.fillEid);
      return newStopEid;
    });

    setSelectedStopEid(stopEid);
  };

  const removeSelectedStop = () => {
    const eid = selectedStopEid();
    if (eid === null) return;
    if (stops().length <= 2) return;
    removeStopEid(eid);
  };

  const removeStopEid = (eid: number) => {
    deleteEntity(world, eid);
    if (selectedStopEid() === eid) setSelectedStopEid(null);
    if (colorPickerStopEid() === eid) setColorPickerStopEid(null);
  };

  const redistributeStopsEvenly = () => {
    if (stops().length <= 1) return;

    const denom = Math.max(stops().length - 1, 1);
    world.history.transaction('Redistribute gradient stops', () => {
      for (const [index, stop] of stops().entries()) {
        setComponent(world, stop.eid, c.ColorStop, { offset: index / denom });
      }
    });
  };

  const duplicateStop = (eid: number) => {
    const sorted = stops();
    const sourceIndex = sorted.findIndex(s => s.eid === eid);
    const source = sorted[sourceIndex];
    if (!source) return;

    const sourceOffset = clamp(source.offset, 0, 1);
    const prev = sorted[sourceIndex - 1];
    const next = sorted[sourceIndex + 1];

    let offset = sourceOffset;
    if (next) {
      offset = sourceOffset + (clamp(next.offset, 0, 1) - sourceOffset) / 2;
    } else if (prev) {
      offset = clamp(prev.offset, 0, 1) + (sourceOffset - clamp(prev.offset, 0, 1)) / 2;
    } else {
      offset = clamp(sourceOffset + 0.01, 0, 1);
    }
    if (offset === sourceOffset) {
      offset = clamp(sourceOffset + 0.01, 0, 1);
    }

    const stopEid = world.history.transaction('Duplicate gradient stop', () => {
      const newStopEid = createEntity(world);
      setComponent(world, newStopEid, c.ColorStop, { ...source, offset });
      appendChild(world, newStopEid, props.fillEid);
      return newStopEid;
    });
    setSelectedStopEid(stopEid);
  };

  const removeAllStops = () => {
    world.history.transaction('Remove all gradient stops', () => {
      for (const stop of stops()) {
        deleteEntity(world, stop.eid);
      }
    });
    setSelectedStopEid(null);
    setColorPickerStopEid(null);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Backspace") return;
    const target = e.target as HTMLElement | null;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable
    ) {
      return;
    }
    if (selectedStopEid() === null) return;

    // Prevent the event from bubbling up to the document.
    // otherwise the selection would get deleted instead
    e.preventDefault();
    e.stopImmediatePropagation();
    removeSelectedStop();
  };

  // Capture is important here
  onMount(() => window.addEventListener("keydown", handleKeyDown, { capture: true }));
  onCleanup(() => window.removeEventListener("keydown", handleKeyDown, { capture: true }));

  // Clear stale selection if the selected stop was deleted.
  createEffect(() => {
    const eid = selectedStopEid();
    if (eid === null) return;
    if (!stopEids().includes(eid)) setSelectedStopEid(null);
  });

  createEffect(() => {
    const eid = colorPickerStopEid();
    if (eid === null) return;
    if (!stopEids().includes(eid)) setColorPickerStopEid(null);
  });

  const toggleColorPicker = (_anchor: HTMLElement, eid: number) => {
    setSelectedStopEid(eid);
    // Re-clicking the same swatch closes; a different one switches in place.
    setColorPickerStopEid((prev) => (prev === eid ? null : eid));
  };

  const closeStopColorPicker = () => {
    setColorPickerStopEid(null);
  };

  const focusStop = (eid: number) => {
    setSelectedStopEid(eid);
    // Follow the open picker to this stop; never open a closed one.
    setColorPickerStopEid((prev) => (prev === null ? null : eid));
  };

  // Shared by the track knob and the stop row so both right-click menus stay in sync.
  const stopMenuItems = (eid: number) => (
    <ContextMenuContent>
      <ContextMenuItem
        disabled={stops().length <= 1}
        onSelect={redistributeStopsEvenly}
      >
        Redistribute stops evenly
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => duplicateStop(eid)}>
        Duplicate stop
      </ContextMenuItem>
      <ContextMenuItem
        disabled={stops().length <= 2}
        onSelect={() => removeStopEid(eid)}
      >
        Delete stop
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        disabled={stops().length === 0}
        onSelect={removeAllStops}
      >
        Delete all stops
      </ContextMenuItem>
    </ContextMenuContent>
  );

  const colorPickerStop = createMemo(() => {
    return stops().find(s => s.eid === colorPickerStopEid()) ?? null;
  });

  const insertStopAtRatio = (ratio: number): number => {
    const nearest = stops().slice().sort(
      (a, b) => Math.abs(a.offset - ratio) - Math.abs(b.offset - ratio),
    )[0];

    const stopEid = createEntity(world);
    setComponent(world, stopEid, c.ColorStop, {
      offset: ratio,
      color: nearest?.color ?? 0xFFFFFF,
      opacity: nearest?.opacity ?? 1,
    });
    appendChild(world, stopEid, props.fillEid);

    return stopEid;
  };

  let draggedStopEid: number | null = null;
  let dragStartPointerRatio = 0;
  let dragStartOffset = 0;

  // A drag can outlive its stop; eids can be reused.
  const isLiveStop = (eid: number) =>
    entityExists(world, eid) &&
    hasComponent(world, eid, c.ColorStop) &&
    !hasComponent(world, eid, c.Deleted) &&
    getParentEntity(world, eid) === props.fillEid;

  const roundedVisualOffset = (raw: number) => Math.round(visualOffset(raw) * 100) / 100;

  const displayedStopOffset = (eid: number) =>
    roundedVisualOffset(c.Computed.stopOffset[eid] ?? c.ColorStop.offset[eid] ?? 0);

  const updateStopDragPosition = (pos: { x: number; y: number }) => {
    const eid = draggedStopEid;
    if (eid === null) return;
    if (!isLiveStop(eid)) {
      draggedStopEid = null;
      return;
    }

    const ratio = getSliderRatio(stopTrackRef, pos);
    if (ratio === null) return;

    const next = Math.round(clamp(dragStartOffset + (ratio - dragStartPointerRatio), 0, 1) * 100) / 100;
    if (next === displayedStopOffset(eid)) return;

    setComponent(world, eid, c.ColorStop, { offset: next });
  };

  const beginStopDrag = (eid: number, e: PointerEvent) => {
    if (!isPrimaryPointerButton(e)) return;
    const ratio = getSliderRatio(stopTrackRef, { x: e.clientX, y: e.clientY });
    if (ratio === null) return;
    if (!isLiveStop(eid)) return;

    draggedStopEid = eid;
    dragStartPointerRatio = ratio;
    dragStartOffset = displayedStopOffset(eid);
    focusStop(eid);
    stopDrag.onPointerDown(e);
  };

  const beginInsertAndDragStop = (e: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (!isPrimaryPointerButton(e)) return;
    const ratio = getSliderRatio(stopTrackRef, { x: e.clientX, y: e.clientY });
    if (ratio === null) return;

    let insertedEid: number | null = null;
    world.history.transaction("Insert gradient stop", () => {
      insertedEid = insertStopAtRatio(ratio);
    });
    if (insertedEid !== null) {
      beginStopDrag(insertedEid, e);
    }
  };

  const stopDrag = useDrag({
    onDragStart: updateStopDragPosition,
    onDragMove: updateStopDragPosition,
    onDragEnd: (pos, e) => {
      if (e.type !== 'pointercancel') updateStopDragPosition(pos);
      draggedStopEid = null;
    },
  });

  const rotateGradient = () => {
    setComponent(world, props.fillEid, c.Rotation, (rotation() + 90) % 360);
  };

  const flipGradient = () => {
    world.history.transaction('Flip gradient', () => {
      for (const stop of stops()) {
        setComponent(world, stop.eid, c.ColorStop, { offset: 1 - stop.offset });
      }
    });
  };

  const handleGradientStyleChange = (style: GradientStyleOption | null) => {
    const value = style === "Radial" ? PaintType.RADIAL_GRADIENT : PaintType.LINEAR_GRADIENT;
    setComponent(world, props.fillEid, c.Paint, value);
  };

  const handleRotationChange = (value: number) => {
    value = Math.round(value * 100) / 100;
    setComponent(world, props.fillEid, c.Rotation, ((value % 360) + 360) % 360);
  };

  const gradientLabel = createMemo(() => {
    return fillType() === PaintType.RADIAL_GRADIENT ? "Radial" : "Linear";
  });

  const gradientBackground = createMemo(() => {
    const parts = stops().map(s => {
      const offset = clamp(s.offset * 100, 0, 100);
      return `${mergeColorWithOpacity(s.color, s.opacity)} ${offset}%`;
    });
    return `linear-gradient(90deg, ${parts.join(", ")})`;
  });

  const handleGradientBackgroundClick = (e: MouseEvent & { currentTarget: HTMLDivElement }) => {
    if (e.target !== e.currentTarget) return;
    setSelectedStopEid(null);
  };

  return (
    <>
    <div ref={rootRef} class="flex flex-col gap-4 p-4" onClick={handleGradientBackgroundClick}>
      <div class="flex flex-col gap-4">
        <div class="flex items-center gap-2">
          <Select<GradientStyleOption>
            preventScroll={false}
            class="flex-1"
            value={fillType() === PaintType.RADIAL_GRADIENT ? "Radial" : "Linear"}
            options={[...GRADIENT_STYLE_OPTIONS]}
            onChange={handleGradientStyleChange}
            itemComponent={(itemProps) => (
              <SelectItem item={itemProps.item}>
                {itemProps.item.rawValue}
              </SelectItem>
            )}
          >
            <SelectTrigger>
              <SelectValue class="text-xs">{gradientLabel()}</SelectValue>
            </SelectTrigger>
            <SelectPortal>
              <SelectContent />
            </SelectPortal>
          </Select>
          <ControlledTextField
            class="w-14 shrink-0"
            value={rotation()}
            step={1}
            unit="°"
            autoSelect
            limitEvents
            skipEmpty
            onNumber={handleRotationChange}
          />
          <div class="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger
                as={Button}
                size="icon"
                variant="ghost"
                class="text-muted-foreground"
                onClick={rotateGradient}
              >
                <Icon name="rotate-90" />
              </TooltipTrigger>
              <TooltipContent>Rotate 90°</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                as={Button}
                size="icon"
                variant="ghost"
                class="text-muted-foreground"
                onClick={flipGradient}
              >
                <Icon name="switch-flip" />
              </TooltipTrigger>
              <TooltipContent>Flip</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div class="flex flex-col gap-2 items-center">
          <ContextMenu modal={false}>
            <ContextMenuTrigger
              as="div"
              class="h-7 w-full touch-none rounded-md border border-border-input"
              style={{ "background-image": gradientBackground() }}
              onPointerDown={beginInsertAndDragStop}
            />
            <ContextMenuPortal>
              <ContextMenuContent>
                <ContextMenuItem
                  disabled={stops().length <= 1}
                  onSelect={redistributeStopsEvenly}
                >
                  Redistribute stops evenly
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  disabled={stops().length === 0}
                  onSelect={removeAllStops}
                >
                  Delete all stops
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenuPortal>
          </ContextMenu>
          <div ref={stopTrackRef} class="relative z-10 h-[14px] w-full overflow-visible">
            <For each={sortedStopEids()}>
              {(eid) => (
                <ContextMenu modal={false}>
                  <ContextMenuTrigger
                    as="div"
                    data-stop-control=""
                    class="absolute top-0 touch-none"
                    classList={{ "opacity-80": selectedStopEid() !== eid }}
                    style={{
                      filter: "drop-shadow(0px 3px 3px rgba(0,0,0,0.48)) drop-shadow(0px 2px 1px rgba(0,0,0,0.48))",
                      left: `${roundedVisualOffset(stopByEid(eid)?.offset ?? 0) * 100}%`,
                      transform: "translateX(-50%)",
                    }}
                    onPointerDown={(e) => beginStopDrag(eid, e)}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 18 18"
                      fill="none"
                      class="touch-none"
                    >
                      <path
                        d="M7.48137 1.69753C8.27955 0.766245 9.72025 0.766211 10.5185 1.69746L13.5184 5.19738C13.8291 5.55987 13.9999 6.02154 13.9999 6.49896L13.9999 11.9258C13.9999 13.0304 13.1044 13.9258 11.9999 13.9258L5.99999 13.9258C4.89538 13.9258 3.99993 13.0303 3.99999 11.9257L4.0003 6.49885C4.00033 6.02149 4.17109 5.55989 4.48173 5.19745L7.48137 1.69753Z"
                        fill={colorToHex(stopByEid(eid)?.color ?? 0xFFFFFF)}
                        stroke={
                          selectedStopEid() === eid
                            ? "var(--ring)"
                            : "var(--border-input)"
                        }
                        stroke-width={selectedStopEid() === eid ? 2 : 1}
                        stroke-linejoin="round"
                      />
                    </svg>
                  </ContextMenuTrigger>
                  <ContextMenuPortal>
                    {stopMenuItems(eid)}
                  </ContextMenuPortal>
                </ContextMenu>
              )}
            </For>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-0 border-t border-border">
        <div class="flex items-center h-10 gap-2">
          <span class="flex-1 text-xs text-foreground font-strong">
            Stops
          </span>
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={addStop}
            >
              <Icon name="plus-add" />
            </TooltipTrigger>
            <TooltipContent>Add stop</TooltipContent>
          </Tooltip>
        </div>
        <div class="flex flex-col gap-0 -mb-1.5">
          <For each={sortedStopEids()}>
            {(eid) => (
              <GradientStopRow
                eid={eid}
                offset={stopByEid(eid)?.offset ?? 0}
                color={stopByEid(eid)?.color ?? 0xFFFFFF}
                opacity={stopByEid(eid)?.opacity ?? 1}
                selected={selectedStopEid() === eid}
                selectStop={focusStop}
                toggleColorPicker={toggleColorPicker}
                menu={stopMenuItems(eid)}
              />
            )}
          </For>
        </div>
      </div>
    </div>

      <Show when={colorPickerStopEid() !== null}>
        <FloatingInspectorLayer
          bypassTopMostLayerCheck
          onDismiss={closeStopColorPicker}
          triggerRef={rootRef}
          triggerControlSelector="[data-stop-swatch],[data-stop-control]"
        >
          <FloatingInspector open={true} anchorRef={rootRef}>
            <FloatingInspectorHeader>
              <FloatingInspectorTitle class="flex-1">Stop color</FloatingInspectorTitle>
              <Tooltip>
                <TooltipTrigger
                  as={Button}
                  size="icon"
                  variant="ghost"
                  class="text-muted-foreground"
                  onClick={closeStopColorPicker}
                >
                  <Icon name="close-remove" />
                </TooltipTrigger>
                <TooltipContent>Close</TooltipContent>
              </Tooltip>
            </FloatingInspectorHeader>
            <FloatingInspectorContent class="p-0">
              <Show when={colorPickerStop()}>
                {(stop) => (
                  <ColorOpacityPicker
                    color={stop().color}
                    opacity={stop().opacity}
                    onColorChange={(next) => {
                      setComponent(world, stop().eid, c.ColorStop, { color: next });
                    }}
                    onOpacityChange={(next) => {
                      setComponent(world, stop().eid, c.ColorStop, { opacity: next });
                    }}
                    onBeginChange={(label) => world.history.startTransaction(label)}
                    onEndChange={() => world.history.commitTransaction()}
                  />
                )}
              </Show>
            </FloatingInspectorContent>
          </FloatingInspector>
        </FloatingInspectorLayer>
      </Show>
    </>
  );
}

type GradientStopRowProps = {
  eid: number;
  offset: number;
  color: number;
  opacity: number;
  selected: boolean;
  selectStop(eid: number): void;
  toggleColorPicker(anchor: HTMLElement, eid: number): void;
  menu: JSXElement;
}

function GradientStopRow(props: GradientStopRowProps) {
  const { world } = useEngine();
  const c = world.components;

  const colorText = createMemo(() => colorToHex(props.color).replace("#", ""));
  const [colorDraft, setColorDraft] = createSignal(colorText());

  createEffect(() => {
    setColorDraft(colorText());
  });

  const commitColor = () => {
    const nextColor = parseColor(colorDraft());
    if (nextColor === null) {
      setColorDraft(colorText());
      return;
    }

    setComponent(world, props.eid, c.ColorStop, { color: nextColor });
  };

  const handleColorInput = (event: InputEvent & { currentTarget: HTMLInputElement }) => {
    setColorDraft(event.currentTarget.value);
  };

  const handleColorKeyDown = (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }

    if (event.key !== "Escape") return;
    event.preventDefault();
    const next = colorText();
    setColorDraft(next);
    event.currentTarget.value = next;
    event.currentTarget.blur();
  };

  const handleColorBlur = (event: FocusEvent & { currentTarget: HTMLInputElement }) => {
    commitColor();
    event.currentTarget.value = colorText();
  };

  const handleOffsetChange = (value: number) => {
    setComponent(world, props.eid, c.ColorStop, { offset: Math.max(0, Math.round(value)) / 100 });
  };

  const handleOpacityChange = (value: number) => {
    setComponent(world, props.eid, c.ColorStop, { opacity: clamp(Math.round(value), 0, 100) / 100 });
  };

  const handleClickColorPicker = (e: MouseEvent & { currentTarget: HTMLButtonElement }) => {
    e.stopPropagation();
    props.toggleColorPicker(e.currentTarget, props.eid);
  };

  return (
    <ContextMenu modal={false}>
    <ContextMenuTrigger
      as="div"
      data-stop-control=""
      class="flex min-w-0 items-center gap-2 -mx-4 px-4 py-1.5"
      classList={{ "bg-selection-muted": props.selected }}
      onPointerDown={() => props.selectStop(props.eid)}
    >
      <ControlledTextField
        class="w-15 shrink-0"
        value={Math.round(props.offset * 100)}
        min={0}
        step={1}
        unit="%"
        limitEvents
        skipEmpty
        autoSelect
        onNumber={handleOffsetChange}
        inputClassName="transition-none"
        keyframe={<Keyframe target={props.eid} property="stop.offset" />}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      />

      <div
        class="relative flex min-w-0 flex-1 items-center gap-px after:rounded-md after:pointer-events-none after:absolute after:inset-0 after:opacity-0 after:ring-1 after:ring-inset after:ring-ring after:z-20"
        classList={{ "after:opacity-100": props.selected }}
      >

        <div class="h-7 min-w-0 flex-1 rounded-l-md border border-border-input bg-input pl-1 flex items-center gap-1.5 border-transparent focus-within:border-ring">
          <button
            data-stop-swatch=""
            class="size-5 min-w-5 overflow-hidden rounded-sm"
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onFocusIn={(e) => e.stopPropagation()}
            onClick={handleClickColorPicker}
          >
            <OpacitySwatch color={props.color} opacity={props.opacity} />
          </button>

          <input
            data-paint-editable="true"
            type="text"
            value={colorDraft()}
            class="w-full min-w-0 truncate bg-transparent text-xxs outline-none"
            onInput={handleColorInput}
            onKeyDown={handleColorKeyDown}
            onBlur={handleColorBlur}
            onPointerDown={handleInitialInputPointerDown}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
          />

          <div
            class="shrink-0"
            onPointerDown={(e) => e.stopPropagation()}
            onFocusIn={(e) => e.stopPropagation()}
          >
            <Keyframe target={props.eid} property="stop.color" />
          </div>
        </div>

        <ControlledTextField
          class="w-15 shrink-0"
          value={Math.round(props.opacity * 100)}
          min={0}
          max={100}
          step={1}
          unit="%"
          limitEvents
          skipEmpty
          autoSelect
          onNumber={handleOpacityChange}
          inputClassName="rounded-l-none"
          keyframe={<Keyframe target={props.eid} property="stop.opacity" />}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
        />
      </div>
    </ContextMenuTrigger>
    <ContextMenuPortal>
      {props.menu}
    </ContextMenuPortal>
    </ContextMenu>
  );
}
