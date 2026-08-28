/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createMemo, createSignal } from "solid-js";
import { toast } from "somoto";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Separator } from "@/components/ui/separator";
import { LazyAssetItem } from "@/components/sidebar-left/asset-item";
import { usePromptInput } from "@/context/prompt-input";
import { createDefaultConfig } from "@/components/genai/prompt-input";
import { assetName } from "@diffusionstudio/assets";
import { useTrait } from "@diffusionstudio/koota-solid";
import { AssetId, isScene } from "@diffusionstudio/runtime";
import { useLibrary } from "@/engine/library";
import { pickAndImport } from "@/engine/asset-actions";

import type { Asset } from "@diffusionstudio/assets";
import type { Entity } from "@diffusionstudio/koota";

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
  node: Entity;
  fill: Entity;
  /** Paints `asset` into the fill; see `FillPicker` for what that authors. */
  onSelectAsset(asset: Asset): void;
};

/**
 * The library, as a fill picker: the image and video assets, filtered and
 * searched, one of which becomes the paint. The cards are the asset
 * browser's, so an asset can be renamed, replaced or deleted from here the
 * same way it can from the sidebar.
 */
export function AssetFillPicker(props: AssetFillPickerProps) {
  const { openPromptInput } = usePromptInput();
  const library = useLibrary();

  const [query, setQuery] = createSignal("");
  const [assetFilter, setAssetFilter] = createSignal<AssetFilter>("ALL");

  // A scene's fill is its backdrop, which nothing plays: stills only.
  const filterOptions = createMemo(() =>
    ASSET_FILTER_OPTIONS.filter((option) => option.value === "IMAGE" || !isScene(props.node)),
  );

  const availableAssets = createMemo(() =>
    (library()?.list() ?? []).filter((asset) => {
      if (asset.type === "IMAGE") return true;
      return !isScene(props.node) && (asset.type === "VIDEO" || asset.type === "SEQUENCE");
    }),
  );

  const filteredAssets = createMemo(() => {
    const normalizedQuery = query().trim().toLowerCase();
    const selectedFilter = assetFilter();
    return availableAssets().filter((asset) => {
      if (selectedFilter !== "ALL" && asset.type !== selectedFilter) return false;
      if (!normalizedQuery) return true;
      return assetName(asset).toLowerCase().includes(normalizedQuery);
    });
  });

  const handleImportAssets = async () => {
    const lib = library();
    if (!lib) return;
    try {
      await pickAndImport(lib, "");
    } catch (e) {
      toast("Failed to import assets", { description: (e as Error).message });
    }
  };

  const selectedAssetId = useTrait(() => props.fill, AssetId);

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
                        class="text-muted-foreground data-expanded:bg-accent data-expanded:text-foreground"
                      >
                        <Icon name="preferences-adjust" class="size-6" />
                      </Button>
                    )}
                  />
                )}
              />
              <TooltipContent>Filter assets</TooltipContent>
            </Tooltip>
            <DropdownMenuPortal>
              <DropdownMenuContent class="w-32">
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
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2 px-4 pt-4 overflow-y-auto max-h-96">
        <For each={filteredAssets()}>
          {(asset) => (
            <LazyAssetItem
              asset={asset}
              selected={selectedAssetId()?.value === asset.id}
              onSelect={() => props.onSelectAsset(asset)}
            />
          )}
        </For>
        <Separator class="col-span-2" />
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
