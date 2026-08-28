/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { ControlRow } from "@/components/ui/control-group";
import { ControlledTextField } from "@/components/ui/text-field";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Keyframe } from "@/components/ui/keyframe";
import {
  Checkbox,
  CheckboxControl,
  CheckboxInput,
  CheckboxLabel,
} from "@/components/ui/checkbox";
import { createMemo, For, Show } from "solid-js";
import { useHas, useWorld } from "@diffusionstudio/koota/solid";
import { ClipsContent, Computed, KeepAspectRatio, isScene } from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { syncKeyframe } from "@/engine/keyframes";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuItemDetail,
  DropdownMenuSeparator,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";

import { PRESET_CATEGORIES } from "@/lib/layout-presets";

import type { Entity } from "@diffusionstudio/koota";

type LayoutPanelProps = {
  selection: Entity[];
};

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;

export function LayoutPanel(props: LayoutPanelProps) {
  const world = useWorld();
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  const sceneSelected = createMemo(() => isScene(entity()));
  const width = useDerived(() => entity().get(Computed)?.width ?? 0);
  const height = useDerived(() => entity().get(Computed)?.height ?? 0);

  const keepAspectRatio = useHas(entity, KeepAspectRatio);
  const clipsContent = useHas(entity, ClipsContent);

  const toggleClipsContent = (checked: boolean) => {
    if (checked) {
      entity().add(ClipsContent);
    } else {
      entity().remove(ClipsContent);
    }
  };

  const orientation = createMemo<"square" | "horizontal" | "vertical">(() => {
    const currentWidth = width() || DEFAULT_WIDTH;
    const currentHeight = height() || DEFAULT_HEIGHT;

    if (currentWidth === currentHeight) return "square";
    return currentWidth > currentHeight ? "horizontal" : "vertical";
  });

  /**
   * The ratio the lock keeps: the pinned authored box, or — when the pin is
   * empty because neither bound is authored — the box as currently shown.
   */
  const lockedRatio = () => {
    const aspect = entity().get(KeepAspectRatio);
    if (!aspect) return undefined;
    if (aspect.width > 0 && aspect.height > 0) return aspect.width / aspect.height;
    return width() > 0 && height() > 0 ? width() / height() : undefined;
  };

  const resize = (params: { width?: number; height?: number }) => {
    let { width, height } = params;

    // One bound given, the lock drives the other; both given is a size
    // chosen outright (a preset, an orientation swap) the lock follows.
    const ratio = lockedRatio();
    if (ratio !== undefined) {
      if (width !== undefined && height === undefined) {
        height = Math.round(width / ratio);
      } else if (height !== undefined && width === undefined) {
        width = Math.round(height * ratio);
      }
    }

    if (width !== undefined) {
      width = Math.round(width);
      syncKeyframe(world, editor, entity(), "width", width);
      editor.editProperty(entity(), "width", width);
    }
    if (height !== undefined) {
      height = Math.round(height);
      syncKeyframe(world, editor, entity(), "height", height);
      editor.editProperty(entity(), "height", height);
    }
  };

  const handleWidthChange = (width: number) => {
    resize({ width });
  };

  const handleHeightChange = (height: number) => {
    resize({ height });
  };

  const toggleAspectRatio = () => {
    editor.editProperty(entity(), "keepAspectRatio", !keepAspectRatio());
  };

  const aspectIcon = () => {
    if (orientation() === "square") {
      return "aspect-ratio-1-1";
    }

    if (orientation() === "horizontal") {
      return "aspect-ratio-16-9";
    }

    return "aspect-ratio-9-16";
  };

  const aspectSwitchLabel = () => {
    if (orientation() === "horizontal") {
      return "Switch to vertical";
    }

    if (orientation() === "vertical") {
      return "Switch to horizontal";
    }

    return "Square";
  };

  /**
   * A size chosen outright (orientation swap, preset): the lock follows it
   * rather than fighting it — both bounds are written, and the reconciler
   * re-pins the lock to the authored box on each.
   */
  const setSize = (width: number, height: number) => {
    resize({ width, height });
  };

  const toggleAspectOrientation = () => {
    const currentWidth = width() || DEFAULT_WIDTH;
    const currentHeight = height() || DEFAULT_HEIGHT;

    // Swap width and height
    setSize(currentHeight, currentWidth);
  };

  return (
    <PanelSection
      title={
        <Show when={sceneSelected()} fallback={<span class="text-xs font-450 text-foreground">Layout</span>}>
          <DropdownMenu placement="left">
            <DropdownMenuTrigger
              as="button"
              type="button"
              class="flex items-center text-xs font-450 text-foreground outline-none"
            >
              <span>Layout</span>
              <span class="relative h-6 w-4 shrink-0 overflow-clip">
                <Icon
                  name="chevron-down"
                  class="absolute -left-1 top-0 size-6 text-muted-foreground"
                />
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent class="w-60">
                <For each={PRESET_CATEGORIES}>
                  {(category, index) => (
                    <>
                      <Show when={index() > 0}>
                        <DropdownMenuSeparator />
                      </Show>
                      <DropdownMenuGroup>
                        <DropdownMenuGroupLabel>{category.label}</DropdownMenuGroupLabel>
                        <For each={category.items}>{
                          (item) => (
                            <DropdownMenuItem {...item} onSelect={() => setSize(item.width, item.height)}>
                              <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                                {item.label}
                              </span>
                              <DropdownMenuItemDetail>
                                {item.width}x{item.height}
                              </DropdownMenuItemDetail>
                            </DropdownMenuItem>
                          )
                        }</For>
                      </DropdownMenuGroup>
                    </>
                  )}
                </For>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
        </Show>
      }
      actions={
        <div class="flex items-center gap-1">
          <Show when={sceneSelected()}>
            <Tooltip>
              <TooltipTrigger
                as={Button}
                size="icon"
                variant="ghost"
                class="text-muted-foreground"
                onClick={toggleAspectOrientation}
              >
                <Icon name={aspectIcon()} />
              </TooltipTrigger>
              <TooltipContent>
                {aspectSwitchLabel()}
              </TooltipContent>
            </Tooltip>
          </Show>
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              title={`${keepAspectRatio() ? "Unlock" : "Lock"} aspect ratio`}
              onClick={toggleAspectRatio}
            >
              <Icon name={keepAspectRatio() ? "lock-closed" : "lock-open"} />
            </TooltipTrigger>
            <TooltipContent>
              {keepAspectRatio() ? "Unlock aspect ratio" : "Lock aspect ratio"}
            </TooltipContent>
          </Tooltip>
        </div>
      }
    >
      <ControlRow label="Size" contentClass="grid grid-cols-2 gap-2">
        <ControlledTextField
          class="group"
          icon={<Icon name="prop-width" />}
          value={width()}
          autoSelect
          step={1}
          onNumber={handleWidthChange}
          limitEvents
          skipEmpty
          sliderEnabled
          keyframe={<Keyframe target={entity()} property="width" />}
        />
        <ControlledTextField
          class="group"
          icon={<Icon name="prop-height" />}
          value={height()}
          autoSelect
          step={1}
          onNumber={handleHeightChange}
          limitEvents
          skipEmpty
          sliderEnabled
          keyframe={<Keyframe target={entity()} property="height" />}
        />
      </ControlRow>

      <Show when={sceneSelected()}>
        <Checkbox
          checked={clipsContent()}
          onChange={toggleClipsContent}
          class="flex items-center"
        >
          <CheckboxInput />
          <CheckboxControl />
          <CheckboxLabel>
            Clip content
          </CheckboxLabel>
        </Checkbox>
      </Show>
    </PanelSection>
  );
}
