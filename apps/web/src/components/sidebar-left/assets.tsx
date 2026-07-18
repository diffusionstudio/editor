/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useEngine } from "@/context/engine";
import {
  useAssets,
  loadAsset,
  removeAsset,
  selectAsset,
  clearSelectedAssets,
  useFolders,
  openFolder,
  createFolder,
  assetFolderId,
  nextFolderName,
} from "@/components/engine";
import { usePromptInput } from "@/context/prompt-input";
import { createDefaultConfig } from "@/components/genai/prompt-input";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { MenuIconButton } from "@/components/ui/menu-icon-button";
import { showFileDialog } from "@/utils";
import { toast } from "somoto";
import {
  Breadcrumbs,
  BreadcrumbList,
  BreadcrumbsEllipsis,
  BreadcrumbsItem,
  BreadcrumbsLink,
  BreadcrumbsSeparator,
} from "../ui/breadcrumbs";
import { LazyAssetItem } from "./asset-item";
import { FolderItem, handleFolderDrop, ASSET_DRAG_TYPE, FOLDER_DRAG_TYPE } from "./folder-item";

import type { EngineWorld } from "@/components/engine";
import type { ElectronFileHandle } from "@/lib/electron-file-handle";

export function Assets() {
  let root: HTMLDivElement | undefined;
  let dragCounter = 0;

  const { world } = useEngine();
  const assets = useAssets(world);
  const folders = useFolders(world);
  const { openPromptInput } = usePromptInput();
  const [query, setQuery] = createSignal("");
  const [assetFilter, setAssetFilter] = createSignal<AssetFilter>("ALL");
  const [isDragging, setIsDragging] = createSignal(false);
  const [renamingFolderId, setRenamingFolderId] = createSignal<string | null>(null);


  const selectedAssetId = () => assets.selected().keys().next().value ?? null;

  const activeFilterLabel = () => {
    const value = assetFilter();
    if (value === "ALL") return null;
    return ASSET_FILTER_OPTIONS.find((option) => option.value === value)?.label ?? null;
  };

  const filteredAssets = createMemo(() => {
    const q = query().trim().toLowerCase();
    const list = assets.all();
    const selectedFilter = assetFilter();

    return list.filter((asset) => {
      if (selectedFilter !== "ALL" && asset.type !== selectedFilter) return false;
      if (q) return asset.name.toLowerCase().includes(q);
      return assetFolderId(world, asset) === folders.currentId();
    });
  });

  const visibleFolders = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (q) {
      return folders
        .all()
        .filter((folder) => folder.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return folders.childrenOf(folders.currentId());
  });

  const panelTitle = createMemo(() => folders.get(folders.currentId() ?? "")?.name ?? "Assets");
  const itemCount = createMemo(() => visibleFolders().length + filteredAssets().length);

  // Deep paths collapse like the breadcrumbs docs example:
  // All assets / … / parent / current, with the hidden folders in a dropdown.
  const collapsedFolders = createMemo(() => {
    const path = folders.path();
    return path.length > 2 ? path.slice(0, -2) : [];
  });
  const tailFolders = createMemo(() => {
    const path = folders.path();
    return path.length > 2 ? path.slice(-2) : path;
  });

  const handleGoToParent = () => {
    const id = folders.currentId();
    if (id === null) return;
    openFolder(world, folders.get(id)?.parentId ?? null);
  };

  const getAssetIdFromTarget = (target: EventTarget | null) => {
    const element = target instanceof Element ? target : null;
    return element?.closest("[data-asset-id]")?.getAttribute("data-asset-id") ?? null;
  };

  createEffect(() => {
    const selected = selectedAssetId();
    if (!selected) return;
    if (!assets.get(selected)) {
      clearSelectedAssets(world);
    }
  });

  const importAssets = async (
    handles: ReadonlyArray<File | FileSystemFileHandle | ElectronFileHandle | DataTransferItem>,
  ) => {
    if (handles.length === 0) return;

    try {
      await Promise.all(handles.map((handle) => {
        return loadAsset(world, handle, { folderId: folders.currentId() });
      }));
    } catch (e) {
      toast("Failed to import assets", {
        description: (e as Error).message,
      });
    }
  };

  const handleImportAssets = async () => {
    const files = await showFileDialog();
    await importAssets(files);
  };

  const handleDrop = async (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter = 0;
    setIsDragging(false);

    document.body.style.cursor = "default";

    if (await handleFolderDrop(world, event, folders.currentId())) {
      return;
    }

    const items = Array.from(event.dataTransfer?.items ?? []).filter(
      (item) => item.kind === "file"
    );
    await importAssets(items);
  };

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const isExternalFileDrag = (event: DragEvent) => {
    const types = event.dataTransfer?.types ?? [];
    return (
      types.includes("Files") &&
      !types.includes(ASSET_DRAG_TYPE) &&
      !types.includes(FOLDER_DRAG_TYPE)
    );
  };

  const handleDragEnter = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isExternalFileDrag(event)) return;
    dragCounter++;
    setIsDragging(true);
  };

  const handleDragLeave = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isExternalFileDrag(event)) return;
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      setIsDragging(false);
    }
  };


  const handleSelectAsset = (assetId: string) => {
    selectAsset(world, assetId);
    root?.focus();
  };

  const moveSelection = (delta: number) => {
    const items = Array.from(
      root?.querySelectorAll<HTMLElement>("[data-asset-id]") ?? []
    );
    if (items.length === 0) return;

    const currentId = selectedAssetId();
    const currentIndex = currentId
      ? items.findIndex(item => item.dataset.assetId === currentId)
      : -1;
    const baseIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = Math.min(
      items.length - 1,
      Math.max(0, baseIndex + delta)
    );

    const nextItem = items[nextIndex];
    const nextId = nextItem?.dataset.assetId;
    if (!nextId) return;

    selectAsset(world, nextId);
    nextItem.scrollIntoView({ block: "nearest" });
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable
    ) {
      return;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      const selectedAsset = selectedAssetId();
      if (selectedAsset) {
        event.preventDefault();
        event.stopPropagation();
        removeAsset(world, selectedAsset);
        return;
      }

      const selectedFolder = folders.currentId();
      if (selectedFolder) {
        event.preventDefault();
        openFolder(world, folders.get(selectedFolder)?.parentId ?? null);
      }

      return;
    }

    const columns = 2;
    const deltaByKey: Record<string, number> = {
      ArrowUp: -columns,
      ArrowDown: columns,
      ArrowLeft: -1,
      ArrowRight: 1,
    };
    const delta = deltaByKey[event.key];
    if (delta === undefined) return;

    event.preventDefault();
    moveSelection(delta);
  };

  const handleBackgroundClick = (event: MouseEvent) => {
    if (!getAssetIdFromTarget(event.target)) {
      clearSelectedAssets(world);
    }
  };

  const hasAssets = () => assets.all().length > 0;
  const hasContent = () => hasAssets() || folders.all().length > 0;
  const isFiltering = () => query().trim().length > 0 || assetFilter() !== "ALL";
  const isEmptyView = () => visibleFolders().length === 0 && filteredAssets().length === 0;

  const handleCreateFolder = async () => {
    try {
      const parentId = folders.currentId();
      const folder = await createFolder(world, nextFolderName(world, parentId), parentId);
      setRenamingFolderId(folder.id);
    } catch (e) {
      toast.error("Failed to create folder", { description: (e as Error).message });
    }
  };

  const handleOpenFolder = (folderId: string) => {
    setQuery("");
    openFolder(world, folderId);
  };

  onMount(() => {
    const onCreateFolder = () => handleCreateFolder();
    window.addEventListener("engine:create-folder", onCreateFolder);
    onCleanup(() => window.removeEventListener("engine:create-folder", onCreateFolder));
  });

  return (
    <div
      on:drop={handleDrop}
      on:dragover={handleDragOver}
      on:dragenter={handleDragEnter}
      on:dragleave={handleDragLeave}
      class="relative flex flex-col flex-1 min-h-0 text-foreground text-sm focus:outline-none"
      tabIndex={0}
      ref={root}
      onKeyDown={handleKeyDown}
    >
      <div class="h-12 shrink-0 flex items-center gap-2 px-4 border-y border-border">
        <div class="flex-1 min-w-0 flex items-center gap-0.5 text-[12px] leading-5 font-strong text-foreground">
          <Show when={folders.currentId() !== null}>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Go to parent folder"
              onClick={handleGoToParent}
            >
              <Icon name="chevron-left" class="text-muted-foreground" />
            </Button>
          </Show>
          <span class="truncate">
            {panelTitle()}
            <span class="ml-1 text-muted-foreground">({itemCount()})</span>
          </span>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <Show when={hasAssets()}>
            <MenuIconButton
              tooltip="Filter assets"
              aria-label="Filter assets"
              placement="bottom-start"
              class="text-muted-foreground data-expanded:bg-accent data-expanded:text-foreground"
              icon={<Icon name="preferences-adjust" class="size-6" />}
              contentClass="w-32"
            >
              <For each={ASSET_FILTER_OPTIONS}>
                {(option) => (
                  <DropdownMenuItem
                    tone="neutral"
                    class="gap-1 px-0 pr-2"
                    onSelect={() => setAssetFilter(option.value)}
                  >
                    <FilterIconStack
                      icon={option.icon}
                      selected={assetFilter() === option.value}
                    />
                    <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                      {option.label}
                    </span>
                  </DropdownMenuItem>
                )}
              </For>
            </MenuIconButton>
          </Show>
          <MenuIconButton
            tooltip="Import assets"
            aria-label="Import assets"
            placement="bottom-start"
            shortcut="⌘I"
            class="text-muted-foreground data-expanded:bg-accent data-expanded:text-foreground"
            icon={<Icon name="plus-add" class="size-6" />}
            contentClass="w-40"
          >
            <DropdownMenuItem tone="neutral" onSelect={handleImportAssets}>
              Import assets
              <DropdownMenuShortcut>⌘I</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem tone="neutral" onSelect={handleCreateFolder}>
              Create folder
              <DropdownMenuShortcut>⇧⌘N</DropdownMenuShortcut>
            </DropdownMenuItem>
          </MenuIconButton>
        </div>
      </div>

      <Show when={hasContent() && !isDragging()}>
        <div class="shrink-0 px-4 pt-4 pb-1 flex flex-col gap-4">
          <Show when={folders.currentId() !== null}>
            <Breadcrumbs separator="/">
              <BreadcrumbList class="text-xs gap-1 sm:gap-1">
                <BreadcrumbCrumb world={world} label="All assets" folderId={null} />
                <Show when={collapsedFolders().length > 0}>
                  <BreadcrumbsSeparator />
                  <BreadcrumbsItem>
                    <DropdownMenu placement="bottom-start">
                      <DropdownMenuTrigger class="flex items-center gap-1 rounded outline-none focus-ring hover:text-foreground">
                        <BreadcrumbsEllipsis class="size-4" />
                        <span class="sr-only">Show parent folders</span>
                      </DropdownMenuTrigger>
                      <DropdownMenuPortal>
                        <DropdownMenuContent class="w-40">
                          <For each={collapsedFolders()}>
                            {(folder) => (
                              <DropdownMenuItem
                                tone="neutral"
                                onSelect={() => openFolder(world, folder.id)}
                              >
                                <span class="truncate">{folder.name}</span>
                              </DropdownMenuItem>
                            )}
                          </For>
                        </DropdownMenuContent>
                      </DropdownMenuPortal>
                    </DropdownMenu>
                  </BreadcrumbsItem>
                </Show>
                <For each={tailFolders()}>
                  {(folder) => (
                    <>
                      <BreadcrumbsSeparator />
                      <BreadcrumbCrumb
                        world={world}
                        label={folder.name}
                        folderId={folder.id}
                        current={folder.id === folders.currentId()}
                      />
                    </>
                  )}
                </For>
              </BreadcrumbList>
            </Breadcrumbs>
          </Show>
          <div class="relative">
            <div class="absolute left-1 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
              <Icon name="search" class="size-6" />
            </div>
            <input
              type="text"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              placeholder="Search"
              class="w-full h-7 rounded-md bg-input pl-8 pr-0 text-xs text-foreground placeholder:text-muted-foreground outline-none focus-ring"
            />
          </div>
          <Show when={activeFilterLabel()} keyed>
            {(label) => (
              <div class="flex flex-wrap gap-2">
                <FilterBadge
                  label={label}
                  onRemove={() => setAssetFilter("ALL")}
                />
              </div>
            )}
          </Show>
        </div>
      </Show>

      <div class="relative flex-1 min-h-0 flex flex-col">
        <Show when={isDragging()}>
          <div class="absolute inset-x-2 bottom-2 top-0 z-50 p-2 bg-background rounded-xl border border-ring">
            <div class="absolute inset-0 bg-accent/20 rounded-xl" />
            <div class="size-full flex items-center justify-center rounded-md border border-dashed border-border-input">
              <Icon name="plus-add" class="size-6 text-muted-foreground" />
              <span class="text-xxs font-450 text-muted-foreground">Drop media here</span>
            </div>
          </div>
        </Show>
        <div
          class="flex-1 min-h-0 overflow-y-auto p-4 pt-3"
          onClick={handleBackgroundClick}
        >
          <Show when={isEmptyView() && !isFiltering()}>
            <div class="h-full flex flex-col items-center justify-center gap-4 px-6 pb-[88px] pt-4">
              <div class="flex flex-col items-center gap-1">
                <Icon name="navigation.folder" class="size-8 text-muted-foreground" />
                <span class="text-xs font-450 text-muted-foreground">
                  Add media
                </span>
                <p class="text-xxs text-muted-foreground text-center">
                  Drag here, import from your computer,{"\n"}
                  or, generate something new with AI.
                </p>
              </div>
              <div class="flex flex-col gap-2 w-full">
                <Button variant="secondary" class="w-full" onClick={() => openPromptInput(createDefaultConfig("IMAGE"))}>
                  Generate with AI
                </Button>
                <Button variant="default" class="w-full" onClick={handleImportAssets}>
                  Import media
                </Button>
              </div>
            </div>
          </Show>
          <Show when={isEmptyView() && isFiltering()}>
            <div class="h-full flex items-center justify-center text-xs text-muted-foreground">
              No matching assets
            </div>
          </Show>
          <Show when={visibleFolders().length > 0 || filteredAssets().length > 0}>
            <div class="grid grid-cols-2 gap-x-2 gap-y-4">
              <For each={visibleFolders()}>
                {(folder) => (
                  <FolderItem
                    folder={folder}
                    renaming={renamingFolderId() === folder.id}
                    onRenameStart={() => setRenamingFolderId(folder.id)}
                    onRenameEnd={() => setRenamingFolderId(null)}
                    onOpen={() => handleOpenFolder(folder.id)}
                  />
                )}
              </For>
              <For each={filteredAssets()}>
                {(asset) => (
                  <LazyAssetItem
                    asset={asset}
                    selected={selectedAssetId() === asset.id}
                    onSelect={() => handleSelectAsset(asset.id)}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

type AssetFilter = "ALL" | "VIDEO" | "IMAGE" | "AUDIO";

const ASSET_FILTER_OPTIONS: ReadonlyArray<{
  value: AssetFilter;
  label: string;
  icon: string;
}> = [
    { value: "ALL", label: "All", icon: "all-media-types" },
    { value: "VIDEO", label: "Video", icon: "video" },
    { value: "IMAGE", label: "Image", icon: "media-image" },
    { value: "AUDIO", label: "Audio", icon: "media-audio" },
  ];

type FilterIconStackProps = {
  icon: string;
  selected: boolean;
};

function FilterIconStack(props: FilterIconStackProps) {
  return (
    <div class="flex items-center">
      <span class="w-6 h-7 shrink-0 flex items-center justify-center">
        <Show when={props.selected}>
          <Icon name="confirm-check" class="size-6 text-popover-foreground" />
        </Show>
      </span>
      <span class="w-7 h-7 flex items-center justify-center">
        <Icon name={props.icon} class="size-6 text-popover-foreground" />
      </span>
    </div>
  );
}

type BreadcrumbCrumbProps = {
  world: EngineWorld;
  label: string;
  folderId: string | null;
  current?: boolean;
};

/**
 * One segment of the folder path. Clicking navigates there; assets and
 * folders can be dropped on it to move them to that level.
 */
function BreadcrumbCrumb(props: BreadcrumbCrumbProps) {
  const [isDropTarget, setIsDropTarget] = createSignal(false);

  const isInternalDrag = (event: DragEvent) => {
    const types = event.dataTransfer?.types ?? [];
    return types.includes(ASSET_DRAG_TYPE) || types.includes(FOLDER_DRAG_TYPE);
  };

  const handleDragOver = (event: DragEvent) => {
    if (!isInternalDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDropTarget(true);
  };

  const handleDrop = async (event: DragEvent) => {
    if (!isInternalDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDropTarget(false);
    await handleFolderDrop(props.world, event, props.folderId);
  };

  return (
    <BreadcrumbsItem>
      <BreadcrumbsLink
        as="button"
        current={props.current}
        data-drop-target={isDropTarget()}
        class="max-w-32 truncate rounded px-1 outline-none focus-ring data-[current]:text-muted-foreground hover:text-foreground data-[drop-target=true]:ring-2 data-[drop-target=true]:ring-inset data-[drop-target=true]:ring-ring"
        onClick={() => openFolder(props.world, props.folderId)}
        on:dragover={handleDragOver}
        on:dragleave={() => setIsDropTarget(false)}
        on:drop={handleDrop}
      >
        {props.label}
      </BreadcrumbsLink>
    </BreadcrumbsItem>
  );
}

type FilterBadgeProps = {
  label: string;
  onRemove: () => void;
};

function FilterBadge(props: FilterBadgeProps) {
  return (
    <button
      class="h-5 rounded bg-input pl-1 pr-0 inline-flex items-center gap-1 text-xxs text-foreground outline-none focus-ring"
      onClick={props.onRemove}
    >
      <span>{props.label}</span>
      <span class="relative w-4 h-5 flex items-center justify-center overflow-hidden">
        <Icon name="close-remove-small" class="absolute -left-1 -top-0.5 size-6" />
      </span>
    </button>
  );
}
