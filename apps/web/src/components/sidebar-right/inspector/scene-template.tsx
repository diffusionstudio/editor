/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createSignal } from "solid-js";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";
import { useWorld } from "@diffusionstudio/koota/solid";
import { Scene, SolidPaint } from "@diffusionstudio/reconciler";
import { Root, Source, Tool, ToolType, getNextName, getViewport, screenToWorld } from "@diffusionstudio/runtime";
import { useEditor } from "@/engine/hooks";

import { PRESET_CATEGORIES, type LayoutPresetCategory, type LayoutPreset } from "@/lib/layout-presets";


export function SceneTemplatePanel() {
  const world = useWorld();
  const editor = useEditor();

  const createScene = (preset: LayoutPreset) => {
    const root = world.get(Root)!;
    if (!root.get(Source)?.value) return;

    // Centered in the viewport.
    const viewport = getViewport(world);
    const center = screenToWorld(world, (viewport?.width ?? 0) / 2, (viewport?.height ?? 0) / 2);
    const name = getNextName(world, "Scene");
    const x = Math.round(center.x - preset.width / 2);
    const y = Math.round(center.y - preset.height / 2);

    const [scene] = editor.insertElement(root, () => (
      <Scene name={name} x={x} y={y} width={preset.width} height={preset.height}>
        <SolidPaint color="#000000" />
      </Scene>
    ));
    if (scene) {
      editor.activate(scene);
      editor.select(scene);
    }

    world.set(Tool, { value: ToolType.MOVE });
  };

  return (
    <PanelSection title="Scene" class="px-0 pt-0 pb-0 gap-0">
      <For each={PRESET_CATEGORIES}>
        {(category) => <PresetGroup category={category} onSelect={createScene} />}
      </For>
    </PanelSection>
  );
}

type PresetGroupProps = {
  category: LayoutPresetCategory;
  onSelect: (preset: LayoutPreset) => void;
};

function PresetGroup(props: PresetGroupProps) {
  const [open, setOpen] = createSignal(true);

  return (
    <div class="flex flex-col w-full">
      <button
        class="flex items-center text-muted-foreground h-8 w-full px-4 hover:bg-muted/50 transition-transform"
        onClick={() => setOpen(!open())}
      >
        <div classList={{ "-rotate-90": !open() }} class="flex items-center justify-center size-4 overflow-clip">
          <Icon name="chevron-down" class="min-h-6 min-w-6" />
        </div>
        <div class="flex items-center justify-center size-4 overflow-clip ml-0.5">
          <Icon name={props.category.icon} class="min-h-6 min-w-6" />
        </div>
        <span class="text-xs truncate ml-1.5">
          {props.category.label}
        </span>
      </button>
      <Show when={open()}>
        <For each={props.category.items}>
          {(preset) => (
            <button
              class="flex items-center gap-1 h-8 w-full pl-2 pr-4 hover:bg-muted/50"
              onClick={() => props.onSelect(preset)}
            >
              <div class="size-6 shrink-0" />
              <span class="flex-1 text-[11px] text-muted-foreground truncate text-left">
                {preset.label}
              </span>
              <span class="text-[11px] text-muted-foreground/55 shrink-0">
                {preset.width}&times;{preset.height}
              </span>
            </button>
          )}
        </For>
      </Show>
    </div>
  );
}
