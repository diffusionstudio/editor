/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { AssetThumbnail } from "@/components/ui/asset-thumbnail";
import { Icon } from "@/components/ui/icon";
import { Keyframe } from "@/components/ui/keyframe";
import { OpacitySwatch } from "@/components/ui/opacity-swatch";
import { useTrait, useWorld } from "@diffusionstudio/koota/solid";
import { AssetId, Computed, Paint, PaintType, colorToHex, parseColor } from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { useLibrary } from "@/engine/library";
import { syncKeyframe } from "@/engine/keyframes";
import { readGradientStops, sameGradientStops, type GradientStop } from "@/components/sidebar-right/inspector/gradient-stops";
import { assetName } from "@diffusionstudio/assets";
import { mergeColorWithOpacity } from "@/utils";

import type { Entity } from "@diffusionstudio/koota";

const DRAG_THRESHOLD_PX = 3;

type FillItemProps = {
  fill: Entity;
  onClick?(event: MouseEvent): void;
};

/**
 * One paint, as the fills panel shows it: a swatch of what it paints, its
 * color (a solid) or its name (everything else), and an opacity that doubles
 * as a slider across the row. Both values are props of the paint element, so
 * they are written through the editor and keyframed after.
 */
export function FillItem(props: FillItemProps) {
  const world = useWorld();
  const editor = useEditor();

  const [isDraggingSlider, setIsDraggingSlider] = createSignal(false);

  const [colorDraft, setColorDraft] = createSignal("");
  const [opacityDraft, setOpacityDraft] = createSignal("");
  const [isFocusWithin, setIsFocusWithin] = createSignal(false);

  let rootRef: HTMLDivElement | undefined;
  let activePointerId: number | null = null;
  let pointerStart: { x: number; y: number } | null = null;
  let pointerStartTarget: HTMLElement | null = null;
  let dragStarted = false;

  let cancelColorCommit = false;
  let cancelOpacityCommit = false;

  const color = useDerived(() => props.fill.get(Computed)?.color ?? 0xE0E0E0);
  const opacity = useDerived(() => props.fill.get(Computed)?.opacity ?? 1);

  const updateColor = (next: number) => {
    const hex = colorToHex(next);
    editor.editProperty(props.fill, "color", hex);
    syncKeyframe(world, editor, props.fill, "color", hex);
  };

  const updateOpacity = (next: number) => {
    const value = Math.round(next * 100) / 100;
    editor.editProperty(props.fill, "opacity", value === 1 ? false : value);
    syncKeyframe(world, editor, props.fill, "opacity", value);
  };

  const paint = useTrait(() => props.fill, Paint);
  const isSolidFill = createMemo(() => (paint()?.value ?? PaintType.SOLID) === PaintType.SOLID);

  const colorText = createMemo(() => colorToHex(color()).replace("#", ""));

  createEffect(() => {
    setColorDraft(colorText());
  });

  const opacityPercent = createMemo(() => Math.round(opacity() * 100));
  createEffect(() => {
    setOpacityDraft(`${opacityPercent()}%`);
  });

  const applyOpacityFromClientX = (clientX: number) => {
    const root = rootRef;
    if (!root) return;

    const rect = root.getBoundingClientRect();
    if (rect.width <= 0) return;

    const ratio = (clientX - rect.left) / rect.width;
    const clamped = Math.max(0, Math.min(1, ratio));

    updateOpacity(clamped);
  };

  const commitColor = () => {
    const nextColor = parseColor(colorDraft());
    if (nextColor === null) {
      setColorDraft(colorText());
      return;
    }

    if (nextColor === color()) return;

    updateColor(nextColor);
  };

  const commitOpacity = () => {
    const raw = opacityDraft().replace("%", "").trim();
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) {
      setOpacityDraft(`${opacityPercent()}%`);
      return;
    }

    const clamped = Math.max(0, Math.min(100, Math.round(parsed)));
    const nextOpacity = clamped / 100;

    updateOpacity(nextOpacity);
  };

  const resetPointerState = () => {
    activePointerId = null;
    pointerStart = null;
    dragStarted = false;
  };

  const removeWindowListeners = () => {
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerUp);
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (activePointerId === null || event.pointerId !== activePointerId) return;
    if (!pointerStart) return;

    const moved = Math.abs(event.clientX - pointerStart.x) >= DRAG_THRESHOLD_PX;
    if (!dragStarted && moved) {
      dragStarted = true;
      setIsDraggingSlider(true);
      const active = document.activeElement;
      if (active instanceof HTMLElement && rootRef?.contains(active)) {
        active.blur();
      }
    }

    if (dragStarted) {
      applyOpacityFromClientX(event.clientX);
    }
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (activePointerId === null || event.pointerId !== activePointerId) return;

    const wasDragging = dragStarted;
    const startTarget = pointerStartTarget;

    removeWindowListeners();

    if (wasDragging) {
      setIsDraggingSlider(false);
      resetPointerState();
      pointerStartTarget = null;
      return;
    }

    resetPointerState();
    pointerStartTarget = null;

    if (startTarget && rootRef?.contains(startTarget)) {
      if (startTarget instanceof HTMLInputElement) {
        startTarget.focus();
        startTarget.select();
        return;
      }

      const interactive = startTarget.closest(
        "button, [role='button'], a, input, select, textarea",
      );
      if (
        interactive instanceof HTMLElement &&
        interactive !== rootRef &&
        rootRef.contains(interactive)
      ) {
        interactive.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            clientX: event.clientX,
            clientY: event.clientY,
            view: window,
          }),
        );
      }
    }
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (activePointerId !== null) return;
    event.preventDefault();

    pointerStart = { x: event.clientX, y: event.clientY };
    pointerStartTarget = event.target instanceof HTMLElement ? event.target : null;
    activePointerId = event.pointerId;
    dragStarted = false;
    rootRef?.setPointerCapture?.(event.pointerId);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  onCleanup(() => {
    removeWindowListeners();
    setIsDraggingSlider(false);
    resetPointerState();
  });

  const handleFocusIn = () => {
    setIsFocusWithin(true);
  };

  const handleFocusOut = (event: FocusEvent & { currentTarget: HTMLDivElement }) => {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) return;
    setIsFocusWithin(false);
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
    cancelColorCommit = true;
    setColorDraft(colorText());
    event.currentTarget.value = colorText();
    event.currentTarget.blur();
  };

  const handleColorBlur = (event: FocusEvent & { currentTarget: HTMLInputElement }) => {
    if (cancelColorCommit) {
      cancelColorCommit = false;
      event.currentTarget.value = colorText();
      return;
    }

    commitColor();
    event.currentTarget.value = colorText();
  };

  const handleOpacityInput = (event: InputEvent & { currentTarget: HTMLInputElement }) => {
    setOpacityDraft(event.currentTarget.value);
  };

  const handleOpacityKeyDown = (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }

    if (event.key !== "Escape") return;
    event.preventDefault();
    cancelOpacityCommit = true;
    const next = `${opacityPercent()}%`;
    setOpacityDraft(next);
    event.currentTarget.value = next;
    event.currentTarget.blur();
  };

  const handleOpacityBlur = (event: FocusEvent & { currentTarget: HTMLInputElement }) => {
    if (cancelOpacityCommit) {
      cancelOpacityCommit = false;
      setOpacityDraft(`${opacityPercent()}%`);
      event.currentTarget.value = opacityDraft();
      return;
    }

    commitOpacity();
    setOpacityDraft(`${opacityPercent()}%`);
    event.currentTarget.value = opacityDraft();
  };

  return (
    <div
      ref={rootRef}
      class="relative h-7 w-full overflow-hidden rounded-md border bg-input text-foreground select-none"
      classList={{
        "border-primary": isFocusWithin(),
        "border-transparent": !isFocusWithin(),
      }}
      onPointerDown={handlePointerDown}
      onFocusIn={handleFocusIn}
      onFocusOut={handleFocusOut}
    >
      <div
        class="pointer-events-none absolute inset-y-0 left-0 rounded-sm bg-muted"
        style={{ width: `${opacityPercent()}%` }}
      >
        <div
          class="absolute inset-y-1 right-1 w-0.5 rounded-full bg-input"
          classList={{ hidden: !isDraggingSlider() }}
        />
      </div>

      <div class="relative z-0 flex h-full items-center justify-between pl-1">
        <div class="flex min-w-0 items-center gap-2">
          <button
            class="size-5 min-w-5 overflow-hidden rounded-sm"
            onFocusIn={(e) => e.stopPropagation()}
            onClick={props.onClick}
          >
            <PaintItemIcon fill={props.fill} />
          </button>

          <Show when={isSolidFill()}>
            <input
              data-paint-editable="true"
              type="text"
              value={colorDraft()}
              class="w-[7ch] bg-transparent text-xxs outline-none"
              classList={{ "cursor-default": !isFocusWithin() }}
              onInput={handleColorInput}
              onKeyDown={handleColorKeyDown}
              onBlur={handleColorBlur}
            />
          </Show>

          <Show when={!isSolidFill()}>
            <FillLabel fill={props.fill} />
          </Show>

        </div>

        <div class="flex items-center">
          <input
            data-paint-editable="true"
            type="text"
            value={opacityDraft()}
            class="w-10 text-right text-xxs outline-none"
            classList={{ "cursor-default": !isFocusWithin() }}
            onInput={handleOpacityInput}
            onKeyDown={handleOpacityKeyDown}
            onBlur={handleOpacityBlur}
          />

          <div
            class="z-20 min-w-2"
            onFocusIn={(e) => e.stopPropagation()}
          >
            <Keyframe property="opacity" target={props.fill} />
          </div>
        </div>
      </div>
    </div>
  );
}

type PaintItemIconProps = {
  fill: Entity;
};

function PaintItemIcon(props: PaintItemIconProps) {
  const world = useWorld();
  const library = useLibrary();

  const assetId = useTrait(() => props.fill, AssetId);
  const paint = useTrait(() => props.fill, Paint);
  const color = useDerived(() => props.fill.get(Computed)?.color ?? 0xE0E0E0);
  const opacity = useDerived(() => props.fill.get(Computed)?.opacity ?? 1);
  const stops = useDerived(() => readGradientStops(world, props.fill), sameGradientStops);

  const type = () => paint()?.value ?? PaintType.SOLID;
  const asset = createMemo(() => library()?.get(assetId()?.value ?? ""));

  return (
    <>
      <Show when={asset() && (type() === PaintType.VIDEO || type() === PaintType.IMAGE)}>
        <AssetThumbnail
          asset={asset()!}
          class="size-full"
          size={{ width: 50, height: 50 }}
          cache={library()?.cache}
        />
      </Show>

      <Show when={type() === PaintType.LINEAR_GRADIENT || type() === PaintType.RADIAL_GRADIENT}>
        <div
          class="size-full"
          style={{ "background-image": getGradientBackground(stops(), type()) }}
        />
      </Show>

      <Show when={type() === PaintType.SOLID}>
        <OpacitySwatch color={color()} opacity={opacity()} />
      </Show>

      <Show when={type() === PaintType.HTML || type() === PaintType.SURFACE || type() === PaintType.SHADER}>
        <div class="flex size-full items-center justify-center bg-muted text-muted-foreground">
          <Icon name="html-small" />
        </div>
      </Show>
    </>
  );
}


type FillLabelProps = {
  fill: Entity;
};

function FillLabel(props: FillLabelProps) {
  const library = useLibrary();

  const paint = useTrait(() => props.fill, Paint);
  const assetId = useTrait(() => props.fill, AssetId);

  const type = () => paint()?.value ?? PaintType.SOLID;

  const label = createMemo(() => {
    if (type() === PaintType.SOLID) {
      return "Solid";
    } else if (type() === PaintType.LINEAR_GRADIENT) {
      return "Linear";
    } else if (type() === PaintType.RADIAL_GRADIENT) {
      return "Radial";
    } else if (type() === PaintType.HTML) {
      return "HTML";
    } else if (type() === PaintType.SURFACE) {
      return "Surface";
    } else if (type() === PaintType.SHADER) {
      return "Shader";
    } else {
      const asset = library()?.get(assetId()?.value ?? "");
      return asset ? assetName(asset) : "Unknown";
    }
  })

  return (
    <span class="min-w-0 truncate text-xxs select-none">
      {label()}
    </span>
  )
}

function getGradientBackground(stops: GradientStop[], style: PaintType) {
  const parts: string[] = [];
  for (let i = 0; i < stops.length; i++) {
    const color = mergeColorWithOpacity(stops[i]!.color, stops[i]!.opacity);
    const offset = (i / (stops.length - 1)) * 100;
    parts.push(`${color} ${offset}%`);
  }

  if (style === PaintType.RADIAL_GRADIENT) {
    return `radial-gradient(circle, ${parts.join(", ")})`;
  }

  return `linear-gradient(90deg, ${parts.join(", ")})`;
}
