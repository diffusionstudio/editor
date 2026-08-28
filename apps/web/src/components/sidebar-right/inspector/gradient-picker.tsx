/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";

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
} from "@/components/ui/floating-inspector";
import { ColorOpacityPicker } from "@/components/ui/color-opacity-picker";
import { useDrag } from "@/hooks/use-drag";
import { clamp, mergeColorWithOpacity } from "@/utils";
import { useTrait, useWorld } from "@diffusionstudio/koota-solid";
import { ColorStop as ColorStopElement } from "@diffusionstudio/reconciler";
import { Computed, Paint, PaintType, colorToHex, parseColor } from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { syncKeyframe } from "@/engine/keyframes";
import { readGradientStops, sameGradientStops, type GradientStop } from "./gradient-stops";

import type { Entity } from "@diffusionstudio/koota";

export type GradientPickerProps = {
  fill: Entity;
  /** Swaps the gradient for one of the other kind, which is another element. */
  onChangeKind(radial: boolean): void;
};

const GRADIENT_STYLE_OPTIONS = ["Linear", "Radial"] as const;
type GradientStyleOption = (typeof GRADIENT_STYLE_OPTIONS)[number];

/** `<colorStop>`'s and `<linearGradientPaint>`'s defaults. */
const DEFAULT_OPACITY = 1;
const DEFAULT_ROTATION = 0;

function handleInitialInputPointerDown(e: PointerEvent & { currentTarget: HTMLInputElement }) {
  if (document.activeElement === e.currentTarget) return;
  e.preventDefault();
  e.currentTarget.focus();
  e.currentTarget.select();
}

function getSliderRatio(
  element: HTMLDivElement | undefined,
  pos: { x: number; y: number },
) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width) return null;
  return Math.round(clamp((pos.x - rect.left) / rect.width, 0, 1) * 100) / 100;
}

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

/**
 * A gradient paint: its stops, its rotation, and which of the two gradient
 * elements it is. Every stop is a `<colorStop offset color opacity>` of its
 * own, so adding, moving and deleting one are element edits; the values shown
 * are `Computed`, which the motion system writes.
 */
export function GradientFillPicker(props: GradientPickerProps) {
  const world = useWorld();
  const editor = useEditor();

  let rootRef: HTMLDivElement | undefined;
  let stopTrackRef: HTMLDivElement | undefined;
  let draggedStop: Entity | null = null;

  const [selectedStop, setSelectedStop] = createSignal<Entity | null>(null);
  const [colorPickerStop, setColorPickerStop] = createSignal<Entity | null>(null);

  const stops = useDerived(() => readGradientStops(world, props.fill), sameGradientStops);

  const paint = useTrait(() => props.fill, Paint);
  const rotation = useDerived(() => props.fill.get(Computed)?.rotation ?? DEFAULT_ROTATION);

  const editOffset = (stop: Entity, offset: number) => {
    editor.editProperty(stop, "offset", offset);
    syncKeyframe(world, editor, stop, "offset", offset);
  };

  const editColor = (stop: Entity, color: number) => {
    const hex = colorToHex(color);
    editor.editProperty(stop, "color", hex);
    syncKeyframe(world, editor, stop, "color", hex);
  };

  const editOpacity = (stop: Entity, opacity: number) => {
    const value = Math.round(opacity * 100) / 100;
    editor.editProperty(stop, "opacity", value === DEFAULT_OPACITY ? false : value);
    syncKeyframe(world, editor, stop, "opacity", value);
  };

  /** Adds a `<colorStop>` and returns it, or null if the fill has no source yet. */
  const insertStop = (offset: number, color: number, opacity: number): Entity | null => {
    const [stop] = editor.insertElement(props.fill, () => (
      <ColorStopElement
        offset={offset}
        color={colorToHex(color)}
        {...(opacity === DEFAULT_OPACITY ? {} : { opacity })}
      />
    ));
    return stop ?? null;
  };

  const addStop = () => {
    const current = stops();
    const first = current[0];
    const second = current[1];

    const adjustedFirstPosition = second
      ? clamp((second.offset ?? 0) / 2, 0, 1)
      : clamp((first?.offset ?? 0) / 2, 0, 1);

    if (first) editOffset(first.entity, adjustedFirstPosition);
    const stop = insertStop(0, first?.color ?? 0xFFFFFF, first?.opacity ?? DEFAULT_OPACITY);
    if (stop) spawnColorPicker(stop);
  };

  const removeStop = (stop: Entity) => {
    editor.remove(stop);
    if (selectedStop() === stop) setSelectedStop(null);
    if (colorPickerStop() === stop) setColorPickerStop(null);
  };

  const removeSelectedStop = () => {
    const stop = selectedStop();
    if (stop === null || stops().length <= 2) return;
    removeStop(stop);
  };

  const redistributeStopsEvenly = () => {
    const current = stops();
    if (current.length <= 1) return;

    const denom = Math.max(current.length - 1, 1);
    for (const [index, stop] of current.entries()) {
      editOffset(stop.entity, index / denom);
    }
  };

  const duplicateStop = (stop: Entity) => {
    const sorted = stops();
    const sourceIndex = sorted.findIndex((s) => s.entity === stop);
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
    }
    if (offset === sourceOffset) {
      offset = clamp(sourceOffset + 0.01, 0, 1);
    }

    const copy = insertStop(offset, source.color, source.opacity);
    if (copy) setSelectedStop(copy);
  };

  const removeAllStops = () => {
    editor.remove(stops().map((stop) => stop.entity));
    setSelectedStop(null);
    setColorPickerStop(null);
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
    if (selectedStop() === null) return;

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
    const stop = selectedStop();
    if (stop === null) return;
    if (!stops().some((s) => s.entity === stop)) setSelectedStop(null);
  });

  createEffect(() => {
    const stop = colorPickerStop();
    if (stop === null) return;
    if (!stops().some((s) => s.entity === stop)) setColorPickerStop(null);
  });

  const spawnColorPicker = (stop: Entity) => {
    setSelectedStop(stop);
    setColorPickerStop(stop);
  };

  const pickedStop = createMemo(() => stops().find((s) => s.entity === colorPickerStop()) ?? null);

  const insertStopAtRatio = (ratio: number): Entity | null => {
    const nearest = stops().slice().sort(
      (a, b) => Math.abs(a.offset - ratio) - Math.abs(b.offset - ratio),
    )[0];

    return insertStop(ratio, nearest?.color ?? 0xFFFFFF, nearest?.opacity ?? DEFAULT_OPACITY);
  };

  const updateStopDragPosition = (pos: { x: number; y: number }) => {
    const ratio = getSliderRatio(stopTrackRef, pos);
    if (draggedStop && ratio !== null) editOffset(draggedStop, ratio);
  };

  const beginStopDrag = (stop: Entity, e: PointerEvent) => {
    if (!isPrimaryPointerButton(e)) return;
    draggedStop = stop;
    setSelectedStop(stop);
    stopDrag.onPointerDown(e);
  };

  const beginInsertAndDragStop = (e: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (!isPrimaryPointerButton(e)) return;
    const ratio = getSliderRatio(stopTrackRef, { x: e.clientX, y: e.clientY });
    if (ratio === null) return;

    const inserted = insertStopAtRatio(ratio);
    if (inserted) beginStopDrag(inserted, e);
  };

  const stopDrag = useDrag({
    onDragStart: updateStopDragPosition,
    onDragMove: updateStopDragPosition,
    onDragEnd: (pos) => {
      updateStopDragPosition(pos);
      draggedStop = null;
    },
  });

  const editRotation = (value: number) => {
    const next = ((value % 360) + 360) % 360;
    editor.editProperty(props.fill, "rotation", next === DEFAULT_ROTATION ? false : next);
    syncKeyframe(world, editor, props.fill, "rotation", next);
  };

  const rotateGradient = () => editRotation(rotation() + 90);

  const flipGradient = () => {
    for (const stop of stops()) {
      editOffset(stop.entity, 1 - stop.offset);
    }
  };

  const handleGradientStyleChange = (style: GradientStyleOption | null) => {
    if (style === null) return;
    props.onChangeKind(style === "Radial");
  };

  const handleRotationChange = (value: number) => {
    editRotation(Math.round(value * 100) / 100);
  };

  const gradientLabel = createMemo(() =>
    paint()?.value === PaintType.RADIAL_GRADIENT ? "Radial" : "Linear",
  );

  const gradientBackground = createMemo(() => {
    const parts = stops().map((s) => {
      const offset = clamp(s.offset * 100, 0, 100);
      return `${mergeColorWithOpacity(s.color, s.opacity)} ${offset}%`;
    });
    return `linear-gradient(90deg, ${parts.join(", ")})`;
  });

  const handleGradientBackgroundClick = () => {
    setSelectedStop(null);
  };

  return (
    <div ref={rootRef} class="flex flex-col gap-4 p-4" onClick={handleGradientBackgroundClick}>
      <div class="flex flex-col gap-4">
        <div class="flex items-center gap-2">
          <Select<GradientStyleOption>
            class="flex-1"
            value={gradientLabel()}
            options={[...GRADIENT_STYLE_OPTIONS]}
            onChange={handleGradientStyleChange}
            itemComponent={(itemProps) => (
              <SelectItem item={itemProps.item}>{itemProps.item.rawValue}</SelectItem>
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
            <For each={stops()}>
              {(stop) => (
                <ContextMenu modal={false}>
                  <ContextMenuTrigger
                    as="div"
                    class="absolute top-0 touch-none"
                    classList={{ "opacity-80": selectedStop() !== stop.entity }}
                    style={{
                      filter: "drop-shadow(0px 3px 3px rgba(0,0,0,0.48)) drop-shadow(0px 2px 1px rgba(0,0,0,0.48))",
                      left: `${visualOffset(stop.offset) * 100}%`,
                      transform: "translateX(-50%)",
                    }}
                    onPointerDown={(e) => beginStopDrag(stop.entity, e)}
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
                        fill={colorToHex(stop.color)}
                        stroke={
                          selectedStop() === stop.entity
                            ? "var(--ring)"
                            : "var(--border-input)"
                        }
                        stroke-width={selectedStop() === stop.entity ? 2 : 1}
                        stroke-linejoin="round"
                      />
                    </svg>
                  </ContextMenuTrigger>
                  <ContextMenuPortal>
                    <ContextMenuContent>
                      <ContextMenuItem
                        disabled={stops().length <= 1}
                        onSelect={redistributeStopsEvenly}
                      >
                        Redistribute stops evenly
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem onSelect={() => duplicateStop(stop.entity)}>
                        Duplicate stop
                      </ContextMenuItem>
                      <ContextMenuItem
                        disabled={stops().length <= 2}
                        onSelect={() => removeStop(stop.entity)}
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
        <div class="flex flex-col gap-3">
          <For each={stops()}>
            {(stop) => (
              <GradientStopRow
                stop={stop}
                selected={selectedStop() === stop.entity}
                onEditOffset={(value) => editOffset(stop.entity, value)}
                onEditColor={(value) => editColor(stop.entity, value)}
                onEditOpacity={(value) => editOpacity(stop.entity, value)}
                onPickColor={() => spawnColorPicker(stop.entity)}
              />
            )}
          </For>
        </div>
      </div>

      <FloatingInspector
        open={colorPickerStop() !== null}
        anchorRef={rootRef}
      >
        <FloatingInspectorHeader>
          <FloatingInspectorTitle class="flex-1">Stop color</FloatingInspectorTitle>
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={() => setColorPickerStop(null)}
            >
              <Icon name="close-remove" />
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        </FloatingInspectorHeader>
        <FloatingInspectorContent class="p-0">
          <Show when={pickedStop()}>
            {(stop) => (
              <ColorOpacityPicker
                color={stop().color}
                opacity={stop().opacity}
                onColorChange={(next) => editColor(stop().entity, next)}
                onOpacityChange={(next) => editOpacity(stop().entity, next)}
                keyframeTarget={stop().entity}
              />
            )}
          </Show>
        </FloatingInspectorContent>
      </FloatingInspector>
    </div>
  );
}

type GradientStopRowProps = {
  stop: GradientStop;
  selected: boolean;
  onEditOffset(value: number): void;
  onEditColor(value: number): void;
  onEditOpacity(value: number): void;
  onPickColor(): void;
};

function GradientStopRow(props: GradientStopRowProps) {
  const colorText = createMemo(() => colorToHex(props.stop.color).replace("#", ""));
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

    props.onEditColor(nextColor);
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
    props.onEditOffset(Math.max(0, Math.round(value)) / 100);
  };

  const handleOpacityChange = (value: number) => {
    props.onEditOpacity(clamp(Math.round(value), 0, 100) / 100);
  };

  const handleClickColorPicker = (e: MouseEvent & { currentTarget: HTMLButtonElement }) => {
    e.stopPropagation();
    props.onPickColor();
  };

  return (
    <div class="flex min-w-0 items-center gap-2">
      <ControlledTextField
        class="w-15 shrink-0"
        value={Math.round(props.stop.offset * 100)}
        min={0}
        step={1}
        unit="%"
        limitEvents
        skipEmpty
        autoSelect
        onNumber={handleOffsetChange}
        inputClassName="transition-none"
        keyframe={<Keyframe target={props.stop.entity} property="offset" />}
      />

      <div
        class="relative flex min-w-0 flex-1 items-center gap-px after:rounded-md after:pointer-events-none after:absolute after:inset-0 after:opacity-0 after:ring-1 after:ring-inset after:ring-ring after:z-20"
        classList={{ "after:opacity-100": props.selected }}
      >

        <div class="h-7 min-w-0 flex-1 rounded-l-md border border-border-input bg-input pl-1 flex items-center gap-1.5 border-transparent focus-within:border-ring">
          <button
            class="size-5 min-w-5 overflow-hidden rounded-sm"
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onFocusIn={(e) => e.stopPropagation()}
            onClick={handleClickColorPicker}
          >
            <OpacitySwatch color={props.stop.color} opacity={props.stop.opacity} />
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
          />

          <div
            class="shrink-0"
            onPointerDown={(e) => e.stopPropagation()}
            onFocusIn={(e) => e.stopPropagation()}
          >
            <Keyframe target={props.stop.entity} property="color" />
          </div>
        </div>

        <ControlledTextField
          class="w-15 shrink-0"
          value={Math.round(props.stop.opacity * 100)}
          min={0}
          max={100}
          step={1}
          unit="%"
          limitEvents
          skipEmpty
          autoSelect
          onNumber={handleOpacityChange}
          inputClassName="rounded-l-none"
          keyframe={<Keyframe target={props.stop.entity} property="opacity" />}
        />
      </div>
    </div>
  );
}
