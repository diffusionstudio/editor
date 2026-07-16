/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createMemo, createSignal, onCleanup, Show, type JSX } from "solid-js";
import { OpacitySwatch } from "@/components/ui/opacity-swatch";
import { colorToHex, parseColor } from "@/utils/color";

type ColorOpacityRowProps = {
  color: number;
  onChangeColor?(color: number): void;
  opacity?: number | null;
  onChangeOpacity?(opacity: number): void;
  onStartTransaction?(): void;
  onEndTransaction?(): void;
  onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
  keyframe?: JSX.Element;
};

const DRAG_THRESHOLD_PX = 3;

function handleInitialInputPointerDown(e: PointerEvent & { currentTarget: HTMLInputElement }) {
  if (document.activeElement === e.currentTarget) return;
  e.preventDefault();
  e.currentTarget.focus();
  e.currentTarget.select();
}

export function ColorOpacityRow(props: ColorOpacityRowProps) {
  const [isDraggingSlider, setIsDraggingSlider] = createSignal(false);
  const [isFocusWithin, setIsFocusWithin] = createSignal(false);
  const colorText = createMemo(() => colorToHex(props.color).replace("#", ""));
  const [colorDraft, setColorDraft] = createSignal(colorText());
  const [opacityDraft, setOpacityDraft] = createSignal(
    `${Math.round((props.opacity ?? 0) * 100)}%`,
  );

  let rootRef: HTMLDivElement | undefined;
  let pendingInputFocus: HTMLInputElement | null = null;
  let activePointerId: number | null = null;
  let dragStartX = 0;
  let dragMoved = false;
  let cancelColorCommit = false;
  let cancelOpacityCommit = false;

  const hasOpacity = createMemo(() => {
    return props.opacity !== undefined && props.opacity !== null;
  });
  const opacityPercent = createMemo(() => Math.round((props.opacity ?? 0) * 100));

  createEffect(() => {
    setColorDraft(colorText());
  });

  createEffect(() => {
    setOpacityDraft(`${opacityPercent()}%`);
  });

  const commitColor = () => {
    const nextColor = parseColor(colorDraft());
    if (nextColor === null) {
      setColorDraft(colorText());
      return;
    }
    if (nextColor === props.color) return;
    props.onChangeColor?.(nextColor);
  };

  const commitOpacity = () => {
    if (!hasOpacity()) return;

    const raw = opacityDraft().replace("%", "").trim();
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) {
      setOpacityDraft(`${opacityPercent()}%`);
      return;
    }

    const clamped = Math.max(0, Math.min(100, Math.round(parsed)));
    props.onChangeOpacity?.(clamped / 100);
  };

  const applyOpacityFromClientX = (clientX: number) => {
    if (!hasOpacity()) return;
    const root = rootRef;
    if (!root) return;

    const rect = root.getBoundingClientRect();
    if (rect.width <= 0) return;

    const ratio = (clientX - rect.left) / rect.width;
    const clamped = Math.max(0, Math.min(1, ratio));
    props.onChangeOpacity?.(clamped);
  };

  const handlePointerDown = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (!hasOpacity()) return;
    if (event.button !== 0) return;
    if (activePointerId !== null) return;

    const target = event.target as HTMLElement | null;
    const editableInput = target?.closest("input[data-paint-editable='true']");

    if (editableInput instanceof HTMLInputElement) {
      pendingInputFocus = editableInput;
      event.preventDefault();
    } else {
      pendingInputFocus = null;
    }

    dragStartX = event.clientX;
    dragMoved = false;
    activePointerId = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!hasOpacity()) return;
    if (activePointerId !== event.pointerId) return;

    const moved = Math.abs(event.clientX - dragStartX) >= DRAG_THRESHOLD_PX;
    if (!dragMoved && moved) {
      dragMoved = true;
      setIsDraggingSlider(true);
      pendingInputFocus = null;
      const active = document.activeElement;
      if (active instanceof HTMLElement && rootRef?.contains(active)) {
        active.blur();
      }
      props.onStartTransaction?.();
    }

    if (!dragMoved) return;
    applyOpacityFromClientX(event.clientX);
  };

  const handlePointerEnd = () => {
    activePointerId = null;
    props.onEndTransaction?.();

    if (isDraggingSlider()) {
      setIsDraggingSlider(false);
    }

    if (!dragMoved && pendingInputFocus) {
      pendingInputFocus.focus();
      pendingInputFocus.select();
    }
    pendingInputFocus = null;
  };

  onCleanup(() => {
    activePointerId = null;
    props.onEndTransaction?.();
    setIsDraggingSlider(false);
  });

  return (
    <div
      ref={rootRef}
      class="group/color-slider relative h-7 w-full overflow-hidden rounded-md bg-input text-foreground border-none outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:opacity-0 after:ring-1 after:ring-inset after:ring-ring after:z-20"
      classList={{
        "after:opacity-100": isFocusWithin(),
      }}
      data-dragging={isDraggingSlider() ? "true" : "false"}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onFocusIn={() => setIsFocusWithin(true)}
      onFocusOut={(event) => {
        const related = event.relatedTarget;
        if (related instanceof Node && event.currentTarget.contains(related)) return;
        setIsFocusWithin(false);
      }}
    >
      <Show when={hasOpacity()}>
        <div
          class="pointer-events-none absolute inset-y-0 left-0 rounded-sm bg-muted"
          style={{ width: `${opacityPercent()}%` }}
        >
          <div class="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 w-0.5 rounded-xs bg-foreground transition-all duration-150 opacity-0 h-0 group-hover/color-slider:opacity-20 group-hover/color-slider:h-3 group-data-[dragging=true]/color-slider:opacity-30 group-data-[dragging=true]/color-slider:h-4" />
        </div>
      </Show>

      <div class="relative z-10 flex h-full items-center">
        <button
          class="flex h-full shrink-0 items-center pl-1 pr-1"
          onClick={props.onClick}
          onPointerDown={(e) => e.stopPropagation()}
          onFocusIn={(e) => e.stopPropagation()}
        >
          <span class="size-5 min-w-5 overflow-hidden rounded-sm">
            <OpacitySwatch color={props.color} opacity={props.opacity ?? 1} />
          </span>
        </button>

        <input
          data-paint-editable="true"
          type="text"
          value={colorDraft()}
          class="h-full min-w-0 flex-1 bg-transparent text-xxs outline-none pl-1"
          classList={{ "cursor-default": !isFocusWithin() }}
          onInput={(event) => setColorDraft(event.currentTarget.value)}
          onPointerDown={hasOpacity() ? undefined : handleInitialInputPointerDown}
          onKeyDown={(event) => {
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
          }}
          onBlur={(event) => {
            if (cancelColorCommit) {
              cancelColorCommit = false;
              event.currentTarget.value = colorText();
              return;
            }

            commitColor();
            event.currentTarget.value = colorText();
          }}
        />

        <Show when={hasOpacity()}>
          <input
            data-paint-editable="true"
            type="text"
            value={opacityDraft()}
            class="h-full shrink-0 text-right text-xxs outline-none"
            classList={{
              "cursor-default": !isFocusWithin(),
              "w-10 pr-2": !props.keyframe,
              "w-8": !!props.keyframe,
            }}
            onInput={(event) => setOpacityDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
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
            }}
            onBlur={(event) => {
              if (cancelOpacityCommit) {
                cancelOpacityCommit = false;
                setOpacityDraft(`${opacityPercent()}%`);
                event.currentTarget.value = opacityDraft();
                return;
              }

              commitOpacity();
              setOpacityDraft(`${opacityPercent()}%`);
              event.currentTarget.value = opacityDraft();
            }}
          />

          <Show when={props.keyframe}>
            <div
              class="min-w-2 z-20 flex h-full items-center"
              onPointerDown={(e) => e.stopPropagation()}
              onFocusIn={(e) => e.stopPropagation()}
            >
              {props.keyframe}
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
