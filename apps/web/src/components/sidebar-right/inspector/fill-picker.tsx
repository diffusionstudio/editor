/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Icon } from "@/components/ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SegmentedIconTabs } from "@/components/ui/segmented-icon-tabs";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorTitle,
} from "@/components/ui/floating-inspector";
import { useTrait, useWorld } from "@diffusionstudio/koota-solid";
import {
  ColorStop as ColorStopElement,
  ImagePaint,
  LinearGradientPaint,
  RadialGradientPaint,
  SolidPaint,
  VideoPaint,
} from "@diffusionstudio/reconciler";
import { BlendMode, BlendModeType, Cache, Paint, PaintType, Rotation, ScaleMode, ScaleModeType } from "@diffusionstudio/runtime";
import { useEditor } from "@/engine/hooks";
import { BLEND_MODE_ORDER, BLEND_MODE_SEPARATORS, blendModeName, displayBlendMode } from "./blend-modes";
import { readStopProps } from "./gradient-stops";
import { SolidFillPicker } from "./solid-picker";
import { GradientFillPicker } from "./gradient-picker";
import { AssetFillPicker } from "./asset-picker";

import type { Fit } from "@diffusionstudio/jsx";
import type { Asset } from "@diffusionstudio/assets";
import type { Entity } from "@diffusionstudio/koota";

export type FillTab = "solid" | "gradient" | "asset";

const TABS = [
  { value: "solid", icon: "fill.solid-color", label: "Color" },
  { value: "gradient", icon: "fill.gradient", label: "Gradient" },
  { value: "asset", icon: "fill.media", label: "Asset" },
];

/** What a fill authors when the picker seeds it. */
const DEFAULT_SOLID_COLOR = "#E0E0E0";
const DEFAULT_GRADIENT_STOPS = ["#E0E0E0", "#000000"];

/**
 * The fit modes `objectFit` can say. `cover` is what an unset prop renders
 * as, and `ScaleModeType.NONE` has no spelling, so it is not offered.
 */
export const FIT_OPTIONS: ReadonlyArray<{ value: Fit; label: string }> = [
  { value: "cover", label: "Cover" },
  { value: "contain", label: "Contain" },
  { value: "fill", label: "Fill" },
];

export const FIT_NAMES: Partial<Record<ScaleModeType, Fit>> = {
  [ScaleModeType.COVER]: "cover",
  [ScaleModeType.FIT]: "contain",
  [ScaleModeType.FILL]: "fill",
};

export type FillPickerProps = {
  anchorRef: HTMLElement;
  node: Entity;
  fill: Entity;
  onClose(): void;
  /** The picker replaced the fill element; this one is the paint now. */
  onReplace(next: Entity): void;
  tabs?: FillTab[];
};

export function getFillTab(paint: PaintType): FillTab {
  if (paint === PaintType.SOLID) return "solid";
  if (paint === PaintType.LINEAR_GRADIENT) return "gradient";
  if (paint === PaintType.RADIAL_GRADIENT) return "gradient";
  return "asset";
}

/**
 * What a fill is, is which paint element it is, so changing its kind is not a
 * property write but a swap: the new element is inserted where the old one
 * stood and the old one removed. The picker therefore hands its caller the
 * entity it ends up with, and what a swap carries over is what the new kind's
 * defaults say, since a color is not a gradient and neither is a picture.
 */
export function FillPicker(props: FillPickerProps) {
  const world = useWorld();
  const editor = useEditor();

  const paint = useTrait(() => props.fill, Paint);
  const paintType = () => paint()?.value ?? PaintType.SOLID;

  const [currentTab, setCurrentTab] = createSignal<FillTab>(getFillTab(paintType()));

  // The element's kind is the truth; a tab the user opened without choosing
  // anything yet (Asset, before an asset is picked) stands until it does.
  createEffect(() => setCurrentTab(getFillTab(paintType())));

  /**
   * Puts `element` where the current fill stands and removes the old one.
   * The anchor is the next fill, so the paint keeps its place in the stack;
   * without one it is appended, which is where it was anyway.
   */
  const replaceFill = (element: () => unknown) => {
    const fills = props.node.get(Cache)?.fills ?? [];
    const index = fills.indexOf(props.fill);
    const anchor = index === -1 ? undefined : fills[index + 1];

    const [next] = editor.insertElement(props.node, element, anchor);
    if (!next) return;

    editor.remove(props.fill);
    props.onReplace(next);
  };

  const handleTabChange = (tab: FillTab) => {
    setCurrentTab(tab);

    if (tab === "solid" && paintType() !== PaintType.SOLID) {
      replaceFill(() => <SolidPaint color={DEFAULT_SOLID_COLOR} />);
      return;
    }

    if (tab === "gradient" && getFillTab(paintType()) !== "gradient") {
      replaceFill(() => (
        <LinearGradientPaint>
          <ColorStopElement offset={0} color={DEFAULT_GRADIENT_STOPS[0]!} />
          <ColorStopElement offset={1} color={DEFAULT_GRADIENT_STOPS[1]!} />
        </LinearGradientPaint>
      ));
    }

    // "asset" waits: which asset it is, is the choice, and until one is
    // picked there is nothing to author.
  };

  /**
   * Swaps a linear gradient for a radial one (or back). The two are separate
   * elements, so the stops and the rotation are written out onto the new one
   * rather than carried by it.
   */
  const handleGradientKindChange = (radial: boolean) => {
    const isRadial = paintType() === PaintType.RADIAL_GRADIENT;
    if (radial === isRadial) return;

    const stops = readStopProps(world, props.fill);
    const rotation = props.fill.get(Rotation)?.value ?? 0;
    const Element = radial ? RadialGradientPaint : LinearGradientPaint;

    replaceFill(() => (
      <Element {...(rotation === 0 ? {} : { rotation })}>
        {stops.map((stop) => (
          <ColorStopElement offset={stop.offset} color={stop.color} opacity={stop.opacity} />
        ))}
      </Element>
    ));
  };

  const handleSelectAsset = (asset: Asset) => {
    // A frames directory plays, and plays through the video paint.
    const plays = asset.type === "VIDEO" || asset.type === "SEQUENCE";
    const current = paintType();
    const sameKind = plays ? current === PaintType.VIDEO : current === PaintType.IMAGE;

    // Same element, another source: a `src` write, so the fit and any tracks
    // under it survive the swap of picture.
    if (sameKind) {
      editor.editProperty(props.fill, "src", asset.path);
      return;
    }

    replaceFill(() => (plays ? <VideoPaint src={asset.path} /> : <ImagePaint src={asset.path} />));
  };

  const availableTabs = createMemo(() => {
    if (props.tabs) return TABS.filter((tab) => props.tabs?.includes(tab.value as FillTab));
    return TABS;
  });

  return (
    <FloatingInspector open anchorRef={props.anchorRef}>
      <FloatingInspectorHeader>
        <FloatingInspectorTitle>
          {TABS.find((mode) => mode.value === currentTab())?.label}
        </FloatingInspectorTitle>
        <div class="ml-auto flex items-center gap-1">
          <Show when={currentTab() === "asset"}>
            <FitMenu fill={props.fill} />
          </Show>
          <BlendModeMenu fill={props.fill} />
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={props.onClose}
            >
              <Icon name="close-remove" class="size-6" />
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        </div>
      </FloatingInspectorHeader>
      <FloatingInspectorContent class="p-0">
        <div class="flex flex-col">
          <div class="px-2 pb-3">
            <SegmentedIconTabs
              value={currentTab}
              onChange={(tab) => handleTabChange(tab as FillTab)}
              items={availableTabs()}
            />
          </div>

          <Show when={currentTab() === "solid"}>
            <SolidFillPicker fill={props.fill} />
          </Show>
          <Show when={currentTab() === "gradient"}>
            <GradientFillPicker fill={props.fill} onChangeKind={handleGradientKindChange} />
          </Show>
          <Show when={currentTab() === "asset"}>
            <AssetFillPicker node={props.node} fill={props.fill} onSelectAsset={handleSelectAsset} />
          </Show>
        </div>
      </FloatingInspectorContent>
    </FloatingInspector>
  );
}

type FitMenuProps = {
  fill: Entity;
};

/**
 * How an asset fill maps into the box: the paint's `objectFit`. Also serves
 * the Source section's picker, where `fill` is the geometry itself — an
 * intrinsic paint's traits live on the node, and the prop is the same.
 */
export function FitMenu(props: FitMenuProps) {
  const editor = useEditor();
  const scaleMode = useTrait(() => props.fill, ScaleMode);

  const current = () => FIT_NAMES[scaleMode()?.value ?? ScaleModeType.COVER] ?? "cover";

  const handleChange = (fit: Fit) => {
    editor.editProperty(props.fill, "objectFit", fit === "cover" ? false : fit);
  };

  return (
    <DropdownMenu placement="bottom-end">
      <Tooltip>
        <TooltipTrigger<typeof DropdownMenuTrigger>
          as={(triggerProps: object) => (
            <DropdownMenuTrigger<typeof Button>
              {...triggerProps}
              as={(buttonProps) => (
                <Button
                  {...buttonProps}
                  size="icon"
                  variant="ghost"
                  class="text-muted-foreground hover:bg-accent data-expanded:bg-accent"
                >
                  <Icon name="media-fit-type" class="size-6" />
                </Button>
              )}
            />
          )}
        />
        <TooltipContent>Fit mode</TooltipContent>
      </Tooltip>
      <DropdownMenuPortal>
        <DropdownMenuContent class="w-[180px]">
          <For each={FIT_OPTIONS}>
            {(option) => (
              <DropdownMenuItem class="px-0 pr-2" onSelect={() => handleChange(option.value)}>
                <span class="w-6 h-7 shrink-0 flex items-center justify-center overflow-clip">
                  <Show when={current() === option.value}>
                    <Icon name="confirm-check" class="text-popover-foreground" />
                  </Show>
                </span>
                <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                  {option.label}
                </span>
              </DropdownMenuItem>
            )}
          </For>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}

type BlendModeMenuProps = {
  fill: Entity;
};

/**
 * The paint's `blendMode`. Hovering a mode previews it by writing the trait
 * alone, so the authored value has to be kept here: while the menu is open
 * the trait holds the hover, and closing without choosing puts it back.
 */
function BlendModeMenu(props: BlendModeMenuProps) {
  const editor = useEditor();

  const blendMode = useTrait(() => props.fill, BlendMode);
  const authored = () => blendMode()?.value ?? BlendModeType.SOURCE_OVER;
  const [selected, setSelected] = createSignal(authored());

  const preview = (mode: BlendModeType) => {
    if (mode === BlendModeType.SOURCE_OVER) {
      props.fill.remove(BlendMode);
      return;
    }
    props.fill.add(BlendMode);
    props.fill.set(BlendMode, { value: mode });
  };

  const handleSelect = (mode: BlendModeType) => {
    setSelected(mode);
    editor.editProperty(
      props.fill,
      "blendMode",
      mode === BlendModeType.SOURCE_OVER ? false : blendModeName(mode),
    );
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && selected() !== authored()) preview(selected());
  };

  return (
    <DropdownMenu placement="bottom-end" onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger<typeof DropdownMenuTrigger>
          as={(triggerProps: object) => (
            <DropdownMenuTrigger<typeof Button>
              {...triggerProps}
              as={(buttonProps) => (
                <Button
                  {...buttonProps}
                  size="icon"
                  variant="ghost"
                  class="text-muted-foreground"
                >
                  <Icon
                    name={selected() === BlendModeType.SOURCE_OVER ? "blending-mode-default" : "blending-mode-set"}
                    class="size-6"
                  />
                </Button>
              )}
            />
          )}
        />
        <TooltipContent>Blend mode</TooltipContent>
      </Tooltip>
      <DropdownMenuPortal>
        <DropdownMenuContent class="w-44 overscroll-contain">
          <For each={BLEND_MODE_ORDER}>
            {(mode) => (
              <>
                <Show when={BLEND_MODE_SEPARATORS.has(mode)}>
                  <DropdownMenuSeparator />
                </Show>
                <DropdownMenuItem
                  onSelect={() => handleSelect(mode)}
                  onPointerEnter={() => preview(mode)}
                >
                  <Show when={selected() === mode} fallback={<div class="size-6" />}>
                    <Icon name="confirm-check" class="size-6 text-primary-foreground" />
                  </Show>
                  <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    {displayBlendMode(mode)}
                  </span>
                </DropdownMenuItem>
              </>
            )}
          </For>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}
