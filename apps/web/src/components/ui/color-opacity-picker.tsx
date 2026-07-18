/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Keyframe } from "@/components/ui/keyframe";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { checkerboardStyle } from "@/components/ui/opacity-swatch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDrag } from "@/hooks/use-drag";
import { assert, clamp, colorToHex, colorToRgb, hslToRgb, hsvToRgb, parseColor, pickScreenColor, rgbToColor, rgbToHsl, rgbToHsv } from "@/utils";
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  Show,
  Switch,
  untrack,
  type Accessor,
  type Setter,
} from "solid-js";
import { useEngine } from "@/context/engine";
import { useQuery } from "@/components/engine/hooks";
import { DEFAULT_BACKGROUND } from "@/components/engine";
import { toast } from "somoto";

const COLOR_TYPES = ["Hex", "HSL", "RGB"] as const;
type ColorType = (typeof COLOR_TYPES)[number];
const OPACITY_INPUT_MAX = 100;

export type ColorOpacityPickerValue = {
  color: number;
  opacity: number;
};

export type ColorOpacityPickerProps = {
  color: number;
  opacity: number;
  onColorChange(next: number): void;
  onOpacityChange?(next: number): void;
  onBeginChange?(label: string): void;
  onEndChange?(): void;
  withoutOpacity?: boolean;
  keyframeTarget?: number;
};

function getSliderRatio(
  element: HTMLDivElement | undefined,
  pos: { x: number; y: number },
) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width) return null;
  return clamp((pos.x - rect.left) / rect.width, 0, 1);
}

function handleInitialInputPointerDown(e: PointerEvent & { currentTarget: HTMLInputElement }) {
  if (document.activeElement === e.currentTarget) return;
  e.preventDefault();
  e.currentTarget.focus();
  e.currentTarget.select();
}

export function ColorOpacityPicker(props: ColorOpacityPickerProps) {
  let colorAreaRef: HTMLDivElement | undefined;
  let hueRef: HTMLDivElement | undefined;
  let opacityRef: HTMLDivElement | undefined;

  const { world } = useEngine();
  const c = world.components;

  const colorEntities = useQuery([c.Color]);

  const documentColors = createMemo(() => {
    const colors = new Set<number>();
    for (const eid of colorEntities()) {
      colors.add(c.Color[eid] ?? DEFAULT_BACKGROUND); // fallback is background color
      if (colors.size >= 36) break;
    }
    return Array.from(colors);
  });

  const [colorType, setColorType] = createSignal<ColorType>("Hex");
  const [isEyeDropperOpen, setIsEyeDropperOpen] = createSignal(false);
  const [isDraggingColorArea, setIsDraggingColorArea] = createSignal(false);

  const opacity = createMemo(() => clamp(props.opacity, 0, 1));

  const [opacityDraft, setOpacityDraft] = createSignal(0);
  createEffect(() => setOpacityDraft(opacity()));

  const initialRgb = colorToRgb(props.color);
  const [hexDraft, setHexDraft] = createSignal(colorToHex(props.color).replace("#", ""));
  const [rgbDraft, setRgbDraft] = createSignal(initialRgb);
  const [hslDraft, setHslDraft] = createSignal({ h: 0, s: 0, l: 0 });
  const [hsvDraft, setHsvDraft] = createSignal(rgbToHsv(initialRgb.r, initialRgb.g, initialRgb.b));

  createEffect(() => {
    if (isDraggingColorArea()) return;

    const rgb = colorToRgb(props.color);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);

    let hue = hsv.h;
    if (hsv.s === 0 || hsv.v === 0) {
      hue = untrack(() => hsvDraft().h);
    }

    batch(() => {
      setHexDraft(colorToHex(props.color).replace("#", ""));
      setRgbDraft(rgb);
      setHslDraft({ ...hsl, h: hsl.s === 0 ? hue : hsl.h });
      setHsvDraft({ ...hsv, h: hue });
    });
  });

  const assignOpacity = (next: number | null) => {
    if (next == null) return;
    props.onOpacityChange?.(Math.round(clamp(next, 0, 1) * 100) / 100);
  };

  const handleEyeDropper = async () => {
    if (isEyeDropperOpen()) return;

    setIsEyeDropperOpen(true);
    try {
      const pickedHex = await pickScreenColor();
      assert(pickedHex, "Picked color is null");
      const parsed = parseColor(pickedHex);
      assert(parsed !== null, "Picked color is invalid");
      props.onColorChange(parsed);
    } catch (error) {
      console.error(error);
      toast.error("Failed to pick color from screen");
    } finally {
      setIsEyeDropperOpen(false);
    }
  };

  const updateSaturationDraft = (pos: { x: number; y: number }) => {
    const currentRect = colorAreaRef?.getBoundingClientRect();
    if (!currentRect) return;

    const x = clamp((pos.x - currentRect.left) / currentRect.width, 0, 1);
    const y = clamp((pos.y - currentRect.top) / currentRect.height, 0, 1);
    const hue = hsvDraft().h;
    const nextHsv = {
      h: hue,
      s: x * 100,
      v: (1 - y) * 100,
    };
    const nextRgb = hsvToRgb(nextHsv.h, nextHsv.s, nextHsv.v);
    const nextHsl = rgbToHsl(nextRgb.r, nextRgb.g, nextRgb.b);

    batch(() => {
      setHsvDraft(nextHsv);
      setRgbDraft(nextRgb);
      setHslDraft({ ...nextHsl, h: hue });
    });
    props.onColorChange(rgbToColor(nextRgb.r, nextRgb.g, nextRgb.b));
  };

  const commitSaturationDraft = () => {
    const nextRgb = hsvToRgb(hsvDraft().h, hsvDraft().s, hsvDraft().v);
    props.onColorChange(rgbToColor(nextRgb.r, nextRgb.g, nextRgb.b));
  };

  const updateHue = (pos: { x: number; y: number }) => {
    const ratio = getSliderRatio(hueRef, pos);
    if (ratio === null) return;
    const hue = Math.round(ratio * 360);
    const nextHsv = { ...hsvDraft(), h: hue };
    const nextRgb = hsvToRgb(nextHsv.h, nextHsv.s, nextHsv.v);
    const nextHsl = rgbToHsl(nextRgb.r, nextRgb.g, nextRgb.b);
    batch(() => {
      setHsvDraft(nextHsv);
      setRgbDraft(nextRgb);
      setHslDraft({ ...nextHsl, h: hue });
    });
    props.onColorChange(rgbToColor(nextRgb.r, nextRgb.g, nextRgb.b));
  };

  const updateOpacity = (pos: { x: number; y: number }) => {
    const ratio = getSliderRatio(opacityRef, pos);
    if (ratio === null) return;
    assignOpacity(ratio);
  };

  const colorAreaDrag = useDrag({
    onDragStart: (pos) => {
      props.onBeginChange?.("Update saturation");
      setIsDraggingColorArea(true);
      updateSaturationDraft(pos);
    },
    onDragMove: (pos) => updateSaturationDraft(pos),
    onDragEnd: (pos) => {
      updateSaturationDraft(pos);
      commitSaturationDraft();
      setIsDraggingColorArea(false);
      props.onEndChange?.();
    },
  });

  const hueDrag = useDrag({
    onDragStart: (pos) => {
      props.onBeginChange?.("Update hue");
      updateHue(pos);
    },
    onDragMove: updateHue,
    onDragEnd: (pos) => {
      updateHue(pos);
      props.onEndChange?.();
    },
  });

  const opacityDrag = useDrag({
    onDragStart: (pos) => {
      props.onBeginChange?.("Update opacity");
      updateOpacity(pos);
    },
    onDragMove: updateOpacity,
    onDragEnd: (pos) => {
      updateOpacity(pos);
      props.onEndChange?.();
    },
  });

  const onOpacityInput = (e: InputEvent & { currentTarget: HTMLInputElement }) => {
    const nextValue = Number.parseFloat(e.currentTarget.value);
    if (Number.isFinite(nextValue)) {
      setOpacityDraft(clamp(nextValue / OPACITY_INPUT_MAX, 0, 1));
    }
  };

  const onOpacityKeyDown = (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (e.key === "Enter") {
      assignOpacity(opacityDraft());
      e.currentTarget.blur();
    }
    if (e.key === "Escape") {
      setOpacityDraft(opacity());
      e.currentTarget.blur();
    }
  };

  const commitHslDraft = () => {
    const { h, s, l } = hslDraft();
    const { r, g, b } = hslToRgb(h, s, l);
    props.onColorChange(rgbToColor(r, g, b));
  };

  const commitRgbDraft = () => {
    const { r, g, b } = rgbDraft();
    props.onColorChange(rgbToColor(r, g, b));
  };

  const commitHexDraft = (next: string) => {
    const parsed = parseColor(next);
    if (parsed !== null) {
      props.onColorChange(parsed);
    }
  };

  return (
    <>
      <div class="px-2">
        <div
          ref={colorAreaRef}
          class="relative aspect-square w-full rounded-md touch-none"
          onPointerDown={colorAreaDrag.onPointerDown}
        >
          <div class="absolute inset-0 rounded-md overflow-hidden">
            <div
              class="absolute inset-0"
              style={{ "background-color": `hsl(${hslDraft().h}, 100%, 50%)` }}
            />
            <div
              class="absolute inset-0"
              style={{
                "background-image":
                  "linear-gradient(90deg, #FFFFFF 0%, rgba(255,255,255,0) 100%)",
              }}
            />
            <div
              class="absolute inset-0"
              style={{
                "background-image":
                  "linear-gradient(180deg, rgba(0,0,0,0) 0%, #000000 100%)",
              }}
            />
          </div>
          <div
            class="absolute size-3.5 rounded-full border-[3px] border-foreground shadow-[0_2px_7px_rgba(0,0,0,0.4)] pointer-events-none"
            style={{
              left: `${hsvDraft().s}%`,
              top: `${100 - hsvDraft().v}%`,
              transform: "translate(-50%, -50%)",
              "background-color": `hsl(${hslDraft().h}, ${hslDraft().s}%, ${hslDraft().l}%)`,
            }}
          />
        </div>
      </div>

      <div class="flex flex-col gap-3 px-4 pt-3 pb-4">
        <div class="flex items-center gap-2.5">
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon-square"
              variant="ghost"
              class="text-muted-foreground"
              onClick={handleEyeDropper}
              disabled={isEyeDropperOpen() || !("EyeDropper" in window)}
            >
              <Icon name="tool.color-picker" class="size-6" />
            </TooltipTrigger>
            <TooltipContent>Pick color from screen</TooltipContent>
          </Tooltip>
          <div class="flex flex-1 flex-col gap-2">
            <div class="flex items-center gap-3">
              <Show when={props.keyframeTarget !== undefined}>
                <Keyframe target={props.keyframeTarget!} property="color" class="size-3" />
              </Show>
              <div
                ref={hueRef}
                class="relative h-3 flex-1 rounded-full"
                style={{
                  "background-image":
                    "linear-gradient(90deg, #FF0000 0%, #FFFF00 17%, #00FF00 33%, #00FFFF 50%, #0000FF 67%, #FF00FF 83%, #FF0000 100%)",
                }}
                onPointerDown={hueDrag.onPointerDown}
              >
                <div
                  class="absolute top-1/2 size-3.5 rounded-full border-[3px] border-foreground shadow-sm pointer-events-none"
                  style={{
                    left: `${(hslDraft().h / 360) * 100}%`,
                    transform: "translate(-50%, -50%)",
                    "background-color": `hsl(${hslDraft().h}, 100%, 50%)`,
                  }}
                />
              </div>

            </div>
            <Show when={!props.withoutOpacity}>
              <div class="flex items-center gap-3">
                <Show when={props.keyframeTarget !== undefined}>
                  <Keyframe target={props.keyframeTarget!} property="opacity" class="size-3" />
                </Show>
                <div
                  ref={opacityRef}
                  class="relative h-3 flex-1 rounded-full"
                  onPointerDown={opacityDrag.onPointerDown}
                >
                  <div class="absolute inset-0 rounded-full" style={checkerboardStyle(6)} />
                  <div
                    class="absolute inset-0 rounded-full"
                    style={{
                      "background-image": `linear-gradient(90deg, rgba(${rgbDraft().r}, ${rgbDraft().g}, ${rgbDraft().b}, 0) 0%, rgba(${rgbDraft().r}, ${rgbDraft().g}, ${rgbDraft().b}, 1) 100%)`,
                    }}
                  />
                  <div
                    class="absolute top-1/2 size-3.5 rounded-full border-[3px] border-foreground shadow-sm pointer-events-none"
                    style={{
                      left: `${opacity() * 100}%`,
                      transform: "translate(-50%, -50%)",
                      "background-color": `rgba(${rgbDraft().r}, ${rgbDraft().g}, ${rgbDraft().b}, ${opacityDraft()})`,
                    }}
                  />
                </div>

              </div>
            </Show>
          </div>
        </div>

        <div class="flex flex-col gap-3">
          <div class="flex gap-px items-center overflow-clip rounded-md">
            <Select
              preventScroll={false}
              value={colorType()}
              onChange={setColorType}
              options={[...COLOR_TYPES]}
              itemComponent={(itemProps) => (
                <SelectItem item={itemProps.item}>{itemProps.item.rawValue}</SelectItem>
              )}
            >
              <SelectTrigger class="w-14 shrink-0 rounded-l-md rounded-r-none after:rounded-l-md after:rounded-r-none">
                <SelectValue>{colorType()}</SelectValue>
              </SelectTrigger>
              <SelectPortal>
                <SelectContent />
              </SelectPortal>
            </Select>

            <Switch>
              <Match when={colorType() === "Hex"}>
                <HexColorInput
                  value={hexDraft}
                  setValue={setHexDraft}
                  onCommit={commitHexDraft}
                  onReset={() => setHexDraft(colorToHex(props.color))}
                />
              </Match>
              <Match when={colorType() === "HSL"}>
                <HslColorInput
                  value={hslDraft}
                  setValue={setHslDraft}
                  onCommit={commitHslDraft}
                  onReset={() => setHslDraft(rgbToHsl(rgbDraft().r, rgbDraft().g, rgbDraft().b))}
                />
              </Match>
              <Match when={colorType() === "RGB"}>
                <RgbColorInput
                  value={rgbDraft}
                  setValue={setRgbDraft}
                  onCommit={commitRgbDraft}
                  onReset={() => setRgbDraft(colorToRgb(props.color))}
                />
              </Match>
            </Switch>

            <Show when={!props.withoutOpacity}>
              <div class="w-14 h-7 shrink-0 rounded-r-md rounded-l-none bg-input flex items-center focus-within:ring-1 focus-within:ring-inset focus-within:ring-ring">
                <input
                  type="text"
                  inputMode="numeric"
                  class="flex-1 min-w-0 bg-transparent pl-2 pr-0 text-sm text-foreground text-left focus:outline-none"
                  value={opacityDraft() * 100}
                  onPointerDown={handleInitialInputPointerDown}
                  onInput={onOpacityInput}
                  onKeyDown={onOpacityKeyDown}
                  maxLength={3}
                />
                <div class="w-6 h-7 flex items-center justify-center text-muted-foreground text-sm">
                  %
                </div>
              </div>
            </Show>
          </div>

          <div class="h-px bg-border" />

          <div class="flex flex-col gap-3">
            <p class="text-xs font-450 text-muted-foreground">
              Document colors
            </p>
            <div class="flex flex-wrap gap-2">
              <For each={documentColors()}>
                {(swatch) => (
                  <button
                    type="button"
                    class="size-4.5 rounded-sm"
                    style={{ "background-color": colorToHex(swatch) }}
                    onClick={() => props.onColorChange(swatch)}
                  />
                )}
              </For>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

type NumberFieldProps = {
  min: number;
  max: number;
  value: Accessor<number>;
  onInput(next: number): void;
  onCommit?(): void;
  onReset?(): void;
};

function NumberField(props: NumberFieldProps) {
  const handleInputChange = (e: InputEvent) => {
    const nextValue = (e.currentTarget as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(nextValue)) {
      props.onInput(nextValue);
    }
  };

  const handleKeyDown = (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (e.key === "Enter") {
      props.onCommit?.();
      e.currentTarget.blur();
    }
    if (e.key === "Escape") {
      props.onReset?.();
      e.currentTarget.blur();
    }
  };

  return (
    <div class="flex-1 min-w-0 h-7 rounded-none bg-input flex items-center focus-within:ring-1 focus-within:ring-inset focus-within:ring-ring">
      <input
        type="number"
        class="w-full bg-transparent px-2 text-sm text-foreground focus:outline-none"
        value={props.value()}
        min={props.min}
        max={props.max}
        onPointerDown={handleInitialInputPointerDown}
        onInput={handleInputChange}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}

type HexColorInputProps = {
  value: Accessor<string>;
  setValue: Setter<string>;
  onCommit(next: string): void;
  onReset(): void;
};

function HexColorInput(props: HexColorInputProps) {
  const handleInput = (e: InputEvent & { currentTarget: HTMLInputElement }) => {
    props.setValue(e.currentTarget.value);
  };

  const handleKeyDown = (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (e.key === "Enter") {
      e.currentTarget.blur();
      props.onCommit(props.value());
    }
    if (e.key === "Escape") {
      props.onReset();
    }
  };

  return (
    <div class="flex-1 min-w-0 h-7 rounded-none bg-input flex items-center focus-within:ring-1 focus-within:ring-inset focus-within:ring-ring">
      <input
        type="text"
        class="flex-1 min-w-0 bg-transparent px-2 text-sm text-foreground focus:outline-none selection:bg-selection selection:text-selection-foreground"
        value={props.value()}
        onPointerDown={handleInitialInputPointerDown}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}

type HslColorInputProps = {
  value: Accessor<{ h: number; s: number; l: number }>;
  setValue: Setter<{ h: number; s: number; l: number }>;
  onCommit(): void;
  onReset(): void;
};

function HslColorInput(props: HslColorInputProps) {
  return (
    <>
      <NumberField
        value={() => props.value().h}
        min={0}
        max={360}
        onInput={(next) => props.setValue((prev) => ({ ...prev, h: next }))}
        onCommit={props.onCommit}
        onReset={props.onReset}
      />
      <NumberField
        value={() => props.value().s}
        min={0}
        max={100}
        onInput={(next) => props.setValue((prev) => ({ ...prev, s: next }))}
        onCommit={props.onCommit}
        onReset={props.onReset}
      />
      <NumberField
        value={() => props.value().l}
        min={0}
        max={100}
        onInput={(next) => props.setValue((prev) => ({ ...prev, l: next }))}
        onCommit={props.onCommit}
        onReset={props.onReset}
      />
    </>
  );
}

type RgbColorInputProps = {
  value: Accessor<{ r: number; g: number; b: number }>;
  setValue: Setter<{ r: number; g: number; b: number }>;
  onCommit(): void;
  onReset(): void;
};

function RgbColorInput(props: RgbColorInputProps) {
  return (
    <>
      <NumberField
        value={() => props.value().r}
        min={0}
        max={255}
        onInput={(next) => props.setValue((prev) => ({ ...prev, r: next }))}
        onCommit={props.onCommit}
        onReset={props.onReset}
      />
      <NumberField
        value={() => props.value().g}
        min={0}
        max={255}
        onInput={(next) => props.setValue((prev) => ({ ...prev, g: next }))}
        onCommit={props.onCommit}
        onReset={props.onReset}
      />
      <NumberField
        value={() => props.value().b}
        min={0}
        max={255}
        onInput={(next) => props.setValue((prev) => ({ ...prev, b: next }))}
        onCommit={props.onCommit}
        onReset={props.onReset}
      />
    </>
  );
}


