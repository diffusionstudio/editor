/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, createSignal, For, Show } from "solid-js";
import { useQuery, useTrait, useWorld } from "@diffusionstudio/koota/solid";
import { ChildOf, Library, Root, setCamera, Source } from "@diffusionstudio/runtime";
import { Icon } from "@/components/ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuItemDetail,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PRESET_CATEGORIES,
} from "@/lib/layout-presets";
import { useEditor } from "@/engine";
import { droppedFiles, importFiles } from "@/engine/asset-actions";
import { createScene, insertAssetsInNewScene } from "@/engine/new-scene";
import { ASSET_DRAG_TYPE } from "@/components/sidebar-left/folder-item";

import type { Rect } from "@diffusionstudio/runtime";
import type { LayoutPreset } from "@/lib/layout-presets";


const DEFAULT_NAME = "New Scene";
const DEFAULT_PRESET: LayoutPreset = { label: "Long-form 16:9", width: 1920, height: 1080 };

/**
 * The empty-project prompt: a placeholder frame in the middle of the canvas
 * that becomes the first scene on click, with the camera fitted to it so the
 * scene lands exactly where the placeholder was.
 */
export function SceneInitOverlay() {
  const world = useWorld();
  const editor = useEditor();
  const root = world.get(Root)!;
  const source = useTrait(root, Source);
  const children = useQuery(ChildOf(root));

  const [editing, setEditing] = createSignal(false);
  const [selectedPreset, setSelectedPreset] = createSignal<LayoutPreset>(DEFAULT_PRESET);
  const [sceneName, setSceneName] = createSignal(DEFAULT_NAME);
  const [dropping, setDropping] = createSignal(false);

  let overlayRef: HTMLDivElement | undefined;
  let buttonRef: HTMLButtonElement | undefined;

  const showOverlay = createMemo(() => source()?.value && children().length === 0);

  const aspectRatio = () => {
    const p = selectedPreset();
    return `${p.width} / ${p.height}`;
  };

  const isVertical = () => {
    const p = selectedPreset();
    return p.width <= p.height;
  };

  const handleFocus = (e: FocusEvent) => {
    setEditing(true);
    const el = e.currentTarget as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const handleBlur = (e: FocusEvent) => {
    const el = e.currentTarget as HTMLElement;
    const text = el.textContent?.trim() || DEFAULT_NAME;
    setSceneName(text);
    el.textContent = text;
    setEditing(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
    }
  };

  /**
   * Puts the new scene exactly where the placeholder frame is, rather than
   * framing it the way the camera would on its own. A scene made from a
   * dropped asset need not have the placeholder's aspect ratio, so it is
   * fitted inside the frame rather than stretched over it.
   */
  const focusPlaceholder = (rect: Rect) => {
    const buttonRect = buttonRef?.getBoundingClientRect();
    // The overlay covers the canvas, so its rect is the canvas rect.
    const canvasRect = overlayRef?.getBoundingClientRect();
    if (!buttonRect || !canvasRect) return;

    const scale = Math.min(buttonRect.width / rect.width, buttonRect.height / rect.height);
    const screenX = buttonRect.left - canvasRect.left + (buttonRect.width - rect.width * scale) / 2;
    const screenY = buttonRect.top - canvasRect.top + (buttonRect.height - rect.height * scale) / 2;
    setCamera(world, { a: scale, b: 0, c: 0, d: scale, e: screenX - rect.x * scale, f: screenY - rect.y * scale });
  };

  const sceneOptions = () => ({
    ...(sceneName() != DEFAULT_NAME ? { name: sceneName() } : {}),
    format: selectedPreset(),
    focus: focusPlaceholder,
  });

  const handleInitializeScene = () => {
    const scene = createScene(world, selectedPreset(), sceneOptions());
    if (scene) editor.select(scene);
  };

  /**
   * Assets dropped on the placeholder all go into the one scene it becomes,
   * which takes its format from the last of them that has one.
   */
  const handleDrop = async (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDropping(false);

    const library = world.get(Library);
    if (!library) return;

    // Read the transfer before the first await: it is gone by the time an
    // import resolves.
    const assetIds = event.dataTransfer?.getData(ASSET_DRAG_TYPE)?.split(',').filter(Boolean) ?? [];
    const files = droppedFiles(event);

    const assets = assetIds.map((id) => library.get(id)).filter((asset) => asset != null);
    if (files.length) assets.push(...await importFiles(library, files, ''));
    if (!assets.length) return;

    insertAssetsInNewScene(world, assets, sceneOptions());
  };

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDropping(true);
  };

  const handleDragLeave = (event: DragEvent) => {
    // Moving onto the frame or the name is still a drag over the overlay.
    const to = event.relatedTarget;
    if (to instanceof Node && overlayRef?.contains(to)) return;
    setDropping(false);
  };

  return (
    <Show when={showOverlay()}>
      <div
        ref={overlayRef}
        class="absolute inset-0 z-2 flex items-center justify-center"
        on:drop={handleDrop}
        on:dragover={handleDragOver}
        on:dragleave={handleDragLeave}
      >
        <div
          class="relative"
          style={{
            "aspect-ratio": aspectRatio(),
            [isVertical() ? "height" : "width"]: "clamp(0px, 70%, 560px)",
          }}
        >
          <div class="absolute left-0 right-0 bottom-full mb-0.5 flex items-center justify-between">
            <div
              contentEditable
              onFocus={handleFocus}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              class="whitespace-nowrap text-xs h-4.5 font-450 flex items-center text-muted-foreground justify-center leading-none focus-ring outline-none px-0.5 rounded-sm box-content"
              classList={{ 'text-foreground': editing() }}
            >
              {sceneName() ?? DEFAULT_NAME}
            </div>
            <DropdownMenu placement="right">
              <DropdownMenuTrigger
                as="button"
                type="button"
                class="flex items-center ursor-pointer bg-transparent border-none p-0 text-xs font-450 text-muted-foreground outline-none"
              >
                <span>{selectedPreset().label}</span>
                <Icon name="chevron-down" class="size-6" />
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
                          <For each={category.items}>
                            {(item) => (
                              <DropdownMenuItem onSelect={() => setSelectedPreset(item)}>
                                <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                                  {item.label}
                                </span>
                                <DropdownMenuItemDetail>
                                  {item.width}x{item.height}
                                </DropdownMenuItemDetail>
                              </DropdownMenuItem>
                            )}
                          </For>
                        </DropdownMenuGroup>
                      </>
                    )}
                  </For>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenu>
          </div>
          <button
            type="button"
            class="w-full h-full bg-accent/50 border border-border overflow-hidden flex items-center justify-center hover:bg-accent hover:border-input active:bg-muted active:border-input"
            classList={{ 'bg-accent! border-input!': dropping() }}
            onClick={handleInitializeScene}
            ref={buttonRef}
          >
            <Icon name="plus-add" class="size-6 text-muted-foreground" />
          </button>
        </div>

      </div>
    </Show>
  );
}
