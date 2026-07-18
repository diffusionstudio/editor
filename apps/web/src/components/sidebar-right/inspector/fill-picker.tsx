/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  createSignal,
  createEffect,
  createUniqueId,
  Show,
  For,
  createMemo,
} from "solid-js";
import { Icon } from "@/components/ui/icon";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { MenuIconButton } from "@/components/ui/menu-icon-button";
import { SegmentedIconTabs } from "@/components/ui/segmented-icon-tabs";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorTitle,
  FloatingInspectorLayer,
} from "@/components/ui/floating-inspector";
import { BlendModeMenu } from "./blend-mode-menu";
import { SolidFillPicker } from "./solid-picker";
import { GradientFillPicker } from "./gradient-picker";
import { AssetFillPicker } from "./asset-picker";
import { ScaleMode, PaintType, useEntityState, ChildOf, createEntity, deleteEntity, appendChild, removeComponent, setComponent } from "@/components/engine";
import { useEngine } from "@/context/engine";
import { query } from 'bitecs';

export type FillTab = "solid" | "gradient" | "asset";

const TABS = [
  { value: "solid", icon: "fill.solid-color", label: "Color" },
  { value: "gradient", icon: "fill.gradient", label: "Gradient" },
  { value: "asset", icon: "fill.media", label: "Asset" },
]

const SCALE_MODE_OPTIONS: ReadonlyArray<{ value: ScaleMode; label: string; }> = [
  { value: ScaleMode.FILL, label: "Fill", },
  { value: ScaleMode.FIT, label: "Fit", },
  { value: ScaleMode.COVER, label: "Cover", },
  { value: ScaleMode.NONE, label: "None", },
];

export type FillPickerProps = {
  anchorRef: HTMLElement;
  triggerRef?: HTMLElement;
  nodeEid: number;
  fillEid: number;
  open: boolean;
  onClose(): void;
  tabs?: FillTab[];
};

export function getFillTab(paintType: PaintType): FillTab {
  if (paintType === PaintType.SOLID) return "solid";
  if (paintType === PaintType.LINEAR_GRADIENT) return "gradient";
  if (paintType === PaintType.RADIAL_GRADIENT) return "gradient";
  if (paintType === PaintType.VIDEO) return "asset";
  return 'asset';
};

export function FillPicker(props: FillPickerProps) {
  const { world } = useEngine();
  const c = world.components;

  const titleId = createUniqueId();

  const scaleMode = useEntityState(c.ScaleMode, props.fillEid, ScaleMode.FILL);
  const type = useEntityState(c.Paint, props.fillEid, PaintType.SOLID);

  const [currentTab, setCurrentTab] = createSignal<FillTab>(getFillTab(type() ?? PaintType.SOLID));

  createEffect(() => {
    setCurrentTab(getFillTab(type() ?? PaintType.SOLID));
  });

  const seedStop = (position: number, color: number) => {
    const stopEid = createEntity(world);
    setComponent(world, stopEid, c.ColorStop, {
      offset: position,
      opacity: 1,
      color,
    });
    appendChild(world, stopEid, props.fillEid);
  };

  const clearPaint = () => {
    removeComponent(world, props.fillEid, c.Color);
    removeComponent(world, props.fillEid, c.AssetId);
    removeComponent(world, props.fillEid, c.ScaleMode);
    for (const eid of query(world, [ChildOf(props.fillEid)])) {
      deleteEntity(world, eid);
    }
  };

  const handleTabChange = (tab: FillTab) => {
    setCurrentTab(tab);

    world.history.transaction('Change fill type', () => {
      if (tab == "solid") {
        // Remove gradient/asset components, add solid
        clearPaint();
        setComponent(world, props.fillEid, c.Paint, PaintType.SOLID);
        setComponent(world, props.fillEid, c.Color, 0xE0E0E0);
      } else if (tab == "gradient") {
        // Remove solid/asset components, seed two-stop gradient
        clearPaint();
        setComponent(world, props.fillEid, c.Paint, PaintType.LINEAR_GRADIENT);
        seedStop(0, 0xE0E0E0);
        seedStop(1, 0x000000);
      }
    });
  };

  const handleScaleModeChange = (mode: ScaleMode) => {
    setComponent(world, props.fillEid, c.ScaleMode, mode);
  };

  const availableTabs = createMemo(() => {
    if (props.tabs) {
      return TABS.filter((tab) => props.tabs?.includes(tab.value as FillTab));
    }

    return TABS;
  });

  return (
    <FloatingInspectorLayer
      onDismiss={props.onClose}
      triggerRef={props.triggerRef}
      triggerControlSelector="[data-row-control]"
      labelledBy={titleId}
    >
    <FloatingInspector
      open={props.open}
      anchorRef={props.anchorRef}
    >
      <FloatingInspectorHeader>
        <FloatingInspectorTitle id={titleId}>
          {TABS.find((mode) => mode.value === currentTab())?.label}
        </FloatingInspectorTitle>
        <div class="ml-auto flex items-center gap-1">
          <Show when={currentTab() === "asset"}>
            <MenuIconButton
              tooltip="Fit mode"
              aria-label="Change fit mode"
              placement="bottom-end"
              modal
              preventScroll={false}
              class="text-muted-foreground hover:bg-accent data-expanded:bg-accent"
              icon={<Icon name="media-fit-type" class="size-6" />}
              contentClass="w-[180px]"
            >
              <For each={SCALE_MODE_OPTIONS}>
                {(option) => (
                  <DropdownMenuItem
                    class="px-0 pr-2"
                    onSelect={() => handleScaleModeChange(option.value)}
                  >
                    <span class="w-6 h-7 shrink-0 flex items-center justify-center overflow-clip">
                      <Show when={scaleMode() === option.value}>
                        <Icon name="confirm-check" class="text-popover-foreground" />
                      </Show>
                    </span>
                    <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                      {option.label}
                    </span>
                  </DropdownMenuItem>
                )}
              </For>
            </MenuIconButton>
          </Show>
          <BlendModeMenu fillEid={props.fillEid} />
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
            <SolidFillPicker nodeEid={props.nodeEid} fillEid={props.fillEid} />
          </Show>
          <Show when={currentTab() === "gradient"}>
            <GradientFillPicker nodeEid={props.nodeEid} fillEid={props.fillEid} />
          </Show>
          <Show when={currentTab() === "asset"}>
            <AssetFillPicker nodeEid={props.nodeEid} fillEid={props.fillEid} />
          </Show>
        </div>
      </FloatingInspectorContent>
    </FloatingInspector>
    </FloatingInspectorLayer>
  );
}
