/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createMemo, createSignal, type JSX } from "solid-js";
import { toast } from "somoto";

import { downloadAsset } from "@/components/assets/actions";
import { AssetThumbnail } from "@/components/ui/asset-thumbnail";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { MenuIconButton } from "@/components/ui/menu-icon-button";
import { useEngine } from "@/context/engine";
import { usePromptInput } from "@/context/prompt-input";
import { createDefaultConfig } from "@/components/genai/prompt-input";
import { showFileDialog } from "@/utils";
import { formatAssetDuration } from "@/utils/common";
import { Separator } from "@/components/ui/separator";
import { ChildOf, PaintType, isScene, useEntityState, type EngineWorld, removeComponent, setComponent } from "@/components/engine";
import { loadAsset, saveAsset, removeAsset, useAssets } from "@/components/engine";
import { query } from 'bitecs';

import type { Asset } from "@/components/engine/db";

type AssetFilter = "ALL" | "IMAGE" | "VIDEO";

const ASSET_FILTER_OPTIONS: ReadonlyArray<{
  value: AssetFilter;
  label: string;
  icon: string;
}> = [
    { value: "ALL", label: "All", icon: "all-media-types" },
    { value: "VIDEO", label: "Video", icon: "video" },
    { value: "IMAGE", label: "Image", icon: "media-image" },
  ];

export type AssetFillPickerProps = {
  nodeEid: number;
  fillEid: number;
};

export function AssetFillPicker(props: AssetFillPickerProps) {
  const { openPromptInput } = usePromptInput();
  const { world } = useEngine();
  const assets = useAssets(world);
  const c = world.components;

  const [query, setQuery] = createSignal("");
  const [assetFilter, setAssetFilter] = createSignal<AssetFilter>("ALL");

  const sceneSelected = createMemo(() => isScene(world, props.nodeEid));
  const filterOptions = createMemo(() => ASSET_FILTER_OPTIONS.filter((option) => option.value === "IMAGE" || !sceneSelected()));

  const availableAssets = createMemo(() =>
    assets.all()
      .filter((asset) => (asset.type === "IMAGE" || asset.type === "VIDEO" || asset.type === "SEQUENCE")));

  const filteredAssets = createMemo(() => {
    const normalizedQuery = query().trim().toLowerCase();
    const selectedFilter = assetFilter();
    return availableAssets().filter((asset) => {
      if (selectedFilter !== "ALL" && asset.type !== selectedFilter) return false;
      if (!normalizedQuery) return true;
      return asset.name.toLowerCase().includes(normalizedQuery);
    });
  });

  const hasAnyAssets = createMemo(() => availableAssets().length > 0);
  const isFiltering = createMemo(() => query().trim() !== "" || assetFilter() !== "ALL");

  const handleImportAssets = async () => {
    const files = await showFileDialog();
    if (files.length === 0) return;
    try {
      await Promise.all(files.map((file) => loadAsset(world, file)));
    } catch (e) {
      toast("Failed to import assets", { description: (e as Error).message });
    }
  };

  const selectedAssetId = useEntityState(c.AssetId, props.fillEid);

  const selectAsset = (asset: Asset) => {
    if (asset.type !== "IMAGE" && asset.type !== "VIDEO") return;

    // Clear components from other fill types (solid/gradient) before assigning asset
    const paintType = PaintType[asset.type];
    clearColorStops(world, props.fillEid);
    removeComponent(world, props.fillEid, c.Color);
    setComponent(world, props.fillEid, c.AssetId, asset.id);
    setComponent(world, props.fillEid, c.Paint, paintType);
  };

  return (
    <div class="flex flex-col">
      <div class="px-2">
        <div class="relative h-11 flex items-center border-y border-border">
          <div class="w-6 h-7 flex items-center justify-center text-muted-foreground overflow-clip">
            <Icon name="search" />
          </div>
          <input
            type="text"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search in assets"
            class="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
          />
          <MenuIconButton
            tooltip="Filter assets"
            aria-label="Filter assets"
            placement="bottom-end"
            modal
            preventScroll={false}
            class="text-muted-foreground data-expanded:bg-accent data-expanded:text-foreground"
            icon={<Icon name="preferences-adjust" class="size-6" />}
            contentClass="w-32"
          >
            <For each={filterOptions()}>
              {(option) => (
                <DropdownMenuItem
                  tone="neutral"
                  class="gap-1 px-0 pr-2"
                  onSelect={() => setAssetFilter(option.value)}
                >
                  <div class="flex items-center">
                    <span class="w-6 h-7 shrink-0 flex items-center justify-center">
                      <Show when={assetFilter() === option.value}>
                        <Icon name="confirm-check" class="size-6 text-popover-foreground" />
                      </Show>
                    </span>
                    <span class="w-7 h-7 flex items-center justify-center">
                      <Icon name={option.icon} class="size-6 text-popover-foreground" />
                    </span>
                  </div>
                  <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    {option.label}
                  </span>
                </DropdownMenuItem>
              )}
            </For>
          </MenuIconButton>
        </div>
      </div>

      <Show
        when={filteredAssets().length > 0}
        fallback={
          <div class="min-h-52 flex items-center justify-center px-6 py-4">
            <Show
              when={hasAnyAssets() && isFiltering()}
              fallback={
                <div class="flex flex-col items-center gap-1">
                  <span class="text-xs font-450 text-muted-foreground">No assets</span>
                  <p class="text-xxs text-muted-foreground text-center text-balance">
                    Import from your computer, or generate something new with AI.
                  </p>
                </div>
              }
            >
              <span class="text-xs text-muted-foreground">No matching assets</span>
            </Show>
          </div>
        }
      >
        <div class="grid grid-cols-2 gap-2 px-4 pt-4 pb-4 overflow-y-auto max-h-96 min-h-52 content-start">
          <For each={filteredAssets()}>
            {(asset) => (
              <AssetCard
                asset={asset}
                selected={selectedAssetId() === asset.id}
                onSelect={() => selectAsset(asset)}
              />
            )}
          </For>
        </div>
      </Show>

      <div class="mx-4">
        <Separator />
      </div>

      <div class="flex flex-col gap-2 px-4 pb-4 pt-3">
        <Button
          variant="secondary"
          class="w-full"
          onClick={() => openPromptInput(createDefaultConfig("IMAGE"))}
        >
          Generate with AI
        </Button>
        <Button class="w-full" onClick={() => void handleImportAssets()}>
          Import from computer
        </Button>
      </div>
    </div>
  );
}

function clearColorStops(world: EngineWorld, fillEid: number) {
  const c = world.components;
  for (const eid of query(world, [ChildOf(fillEid)])) {
    removeComponent(world, eid, c.ColorStop);
  }
}

function MenuItemLabel(props: { children: JSX.Element }) {
  return (
    <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
      {props.children}
    </span>
  );
}

type AssetCardProps = {
  asset: Asset;
  selected: boolean;
  onSelect(): void;
};

function AssetCard(props: AssetCardProps) {
  const { world } = useEngine();

  const duration = createMemo(() => formatAssetDuration(props.asset));

  const handlePreview = () => {
    toast("Preview", { description: props.asset.name });
  };

  const handleRename = async () => {
    if (typeof window === "undefined") return;

    const nextName = window.prompt("Rename asset", props.asset.name);
    if (nextName == null) return;
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === props.asset.name) return;

    try {
      await saveAsset(world, { ...props.asset, name: trimmed });
    } catch (e) {
      toast("Failed to rename", { description: (e as Error).message });
    }
  };

  const handleReplace = () => {
    toast("Replace media", { description: props.asset.name });
  };

  const handleDownload = async () => {
    await downloadAsset(props.asset);
  };

  const handleDelete = async () => {
    try {
      await removeAsset(world, props.asset.id);
      toast("Deleted", { description: props.asset.name });
    } catch (e) {
      toast("Failed to delete", { description: (e as Error).message });
    }
  };

  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger as="div" class="contents">
        <button
          type="button"
          class="group flex flex-col gap-1 text-left outline-none"
          aria-pressed={props.selected}
          data-asset-id={props.asset.id}
          onClick={props.onSelect}
        >
          <div
            class="relative w-full rounded-sm aspect-video"
            classList={{ "ring-2 ring-primary": props.selected }}
          >
            <AssetThumbnail
              asset={props.asset}
              class="absolute inset-0 rounded group-hover:brightness-70 overflow-hidden"
            />
            <Show when={duration()}>
              <div class="absolute left-1 top-1 z-20 flex h-4 items-center justify-center rounded-sm bg-overlay px-1">
                <span class="text-xxs text-primary-foreground">
                  {duration()}
                </span>
              </div>
            </Show>
          </div>
          <span
            class="text-xs truncate"
            classList={{
              "text-foreground": props.selected,
              "text-muted-foreground": !props.selected,
            }}
          >
            {props.asset.name}
          </span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent class="w-[180px]">
          <ContextMenuItem onSelect={handlePreview}>
            <MenuItemLabel>Preview</MenuItemLabel>
            <ContextMenuShortcut>Space</ContextMenuShortcut>
          </ContextMenuItem>

          <ContextMenuSeparator />

          <ContextMenuItem onSelect={() => void handleRename()}>
            <MenuItemLabel>Rename</MenuItemLabel>
            <ContextMenuShortcut>⌘R</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleReplace}>
            <MenuItemLabel>Replace</MenuItemLabel>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void handleDownload()}>
            <MenuItemLabel>Download</MenuItemLabel>
          </ContextMenuItem>

          <ContextMenuSeparator />

          <ContextMenuItem onSelect={() => void handleDelete()}>
            <MenuItemLabel>Delete</MenuItemLabel>
            <ContextMenuShortcut>⌫</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenu>
  );
}
