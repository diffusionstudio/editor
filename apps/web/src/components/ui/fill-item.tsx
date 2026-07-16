/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { AssetThumbnail } from "@/components/ui/asset-thumbnail";
import { Keyframe } from "@/components/ui/keyframe";
import { OpacitySwatch } from "@/components/ui/opacity-swatch";
import { useEngine } from "@/context/engine";
import { mergeColorWithOpacity } from "@/utils";
import { colorToHex, parseColor } from "@/utils/color";
import { ChildOf, PaintType, useEntityState, useEntityStates, useQuery, setComponent } from "../engine";
import { Not } from 'bitecs';

const DRAG_THRESHOLD_PX = 3;

type FillItemProps = {
  nodeEid: number;
  fillEid: number;
  onClick?(event: MouseEvent): void;
};

export function FillItem(props: FillItemProps) {
  const { world } = useEngine();
  const c = world.components;

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

  const color = useEntityState(c.Computed.color, props.fillEid, 0xE0E0E0);
  const opacity = useEntityState(c.Computed.opacity, props.fillEid, 1);

  const updateColor = (color: number) => {
    setComponent(world, props.fillEid, c.Color, color);
  };

  const updateOpacity = (opacity: number) => {
    setComponent(world, props.fillEid, c.Appearance, {
      opacity: Math.round(opacity * 100) / 100,
    });
  };

  const fillType = useEntityState(c.Paint, props.fillEid, PaintType.SOLID);
  const isSolidFill = createMemo(() => fillType() === PaintType.SOLID);

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
      world.history.startTransaction("Edit paint opacity");
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
      world.history.commitTransaction();
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
    if (dragStarted) world.history.commitTransaction();
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
      class="relative h-7 w-full overflow-hidden rounded-md bg-input text-foreground select-none border-none outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:opacity-0 after:ring-1 after:ring-inset after:ring-ring after:z-20"
      classList={{
        "after:opacity-100": isFocusWithin(),
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
            <PaintItemIcon fill={props.fillEid} />
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
            <FillLabel fill={props.fillEid} />
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
            <Keyframe property="opacity" target={props.fillEid} />
          </div>
        </div>
      </div>
    </div>
  );
}

type PaintItemIconProps = {
  fill: number;
};

function PaintItemIcon(props: PaintItemIconProps) {
  const { world } = useEngine();
  const c = world.components;
  const assets = world.assets;

  const assetId = useEntityState(c.AssetId, props.fill);
  const stopEids = useQuery([c.ColorStop, ChildOf(props.fill), Not(c.Deleted)]);
  const color = useEntityState(c.Computed.color, props.fill);
  const opacity = useEntityState(c.Computed.opacity, props.fill, 1);
  const type = useEntityState(c.Paint, props.fill, PaintType.SOLID);

  const offsets = useEntityStates(c.Computed.stopOffset, stopEids, 0);
  const colors = useEntityStates(c.Computed.stopColor, stopEids, 0xFFFFFF);
  const opacities = useEntityStates(c.Computed.stopOpacity, stopEids, 1);

  const sortedStops = createMemo(() => stopEids()
    .map((_, idx) => ({
      offset: offsets()[idx],
      color: colors()[idx],
      opacity: opacities()[idx],
    }))
    .toSorted((a, b) => a.offset - b.offset)
  );

  const asset = createMemo(() => assets.get(assetId() ?? ""));

  return (
    <>
      <Show when={asset() && (type() === PaintType.VIDEO || type() === PaintType.IMAGE || type() === PaintType.SEQUENCE)}>
        <AssetThumbnail
          asset={asset()!}
          class="size-full"
          size={{ width: 50, height: 50 }}
        />
      </Show>

      <Show when={type() === PaintType.LINEAR_GRADIENT || type() === PaintType.RADIAL_GRADIENT}>
        <div
          class="size-full"
          style={{ "background-image": getGradientBackground(sortedStops(), type()) }}
        />
      </Show>

      <Show when={color() !== undefined && type() === PaintType.SOLID}>
        <OpacitySwatch color={color()!} opacity={opacity()} />
      </Show>
    </>
  );
}

type FillLabelProps = {
  fill: number;
};

function FillLabel(props: FillLabelProps) {
  const { world } = useEngine();
  const c = world.components;
  const assets = world.assets;

  const type = useEntityState(c.Paint, props.fill, PaintType.SOLID);
  const assetId = useEntityState(c.AssetId, props.fill);

  const label = createMemo(() => {
    if (type() === PaintType.SOLID) {
      return "Solid";
    } else if (type() === PaintType.LINEAR_GRADIENT) {
      return "Linear";
    } else if (type() === PaintType.RADIAL_GRADIENT) {
      return "Radial";
    } else {
      const asset = assets.get(assetId() ?? "");
      return asset?.name ?? "Unknown";
    }
  })

  return (
    <span class="min-w-0 truncate text-xxs select-none">
      {label()}
    </span>
  )
}

type GradientStop = {
  offset: number;
  color: number;
  opacity: number;
};

function getGradientBackground(stops: GradientStop[], style: PaintType) {
  const parts: string[] = [];
  for (let i = 0; i < stops.length; i++) {
    const color = mergeColorWithOpacity(stops[i].color, stops[i].opacity);
    const offset = (i / (stops.length - 1)) * 100;
    parts.push(`${color} ${offset}%`);
  }

  if (style === PaintType.RADIAL_GRADIENT) {
    return `radial-gradient(circle, ${parts.join(", ")})`;
  }

  return `linear-gradient(90deg, ${parts.join(", ")})`;
}
