/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useWorld } from "@diffusionstudio/koota-solid";
import { findSceneAt, getSelection, isPointerInEntity, screenToWorld, worldToLocal, Library, RenderSurface, Root } from "@diffusionstudio/runtime";
import { CameraController, EngineCanvas } from "@/engine";
import { forkPrompt, forkTemplate, insertPrompt } from "@/engine/prompt";
import { insertAsset } from "@/engine/insert-asset";
import { selectionAssets } from "@/engine/asset-folders";
import { useObjectActions } from "@/components/genai/use-object-actions";
import { usePromptInput } from "@/context/prompt-input";
import { droppedFiles, importFiles } from "@/engine/asset-actions";
import { Toolbar } from "./toolbar";
import { DrawOverlay } from "./draw-overlay";
import { DesktopAppBanner } from "./desktop-app-banner";
import { toast } from "somoto"
import { SceneInitOverlay } from "./scene-init-overlay";
import { PromptNodes } from "./prompt-node";
import { offerContextMenuItems } from "@/components/context-menu-extras";
import { finderPath, revealInAssets, revealInFinder } from "@/components/sidebar-left/reveal";
import { ASSET_DRAG_TYPE } from "@/components/sidebar-left/folder-item";

import type { JSX } from "solid-js";
import { assetFolder, basename } from "@diffusionstudio/assets";
import type { Asset, AssetLibrary } from "@diffusionstudio/assets";
import type { ContextMenuExtra } from "@/components/context-menu-extras";

type CanvasProps = {
  style?: JSX.CSSProperties;
}

let recentFolders: string[] = [];

function setFolder(library: AssetLibrary, assets: Asset[]): ContextMenuExtra {
  const current = new Set(assets.map(assetFolder));
  const checked = (folder: string) => current.size === 1 && current.has(folder);
  const move = (folder: string) => () => {
    library.move(assets, folder);
    if (folder) recentFolders = [folder, ...recentFolders.filter((recent) => recent !== folder)].slice(0, 3);
  };
  const branch = (folder: string): ContextMenuExtra => {
    const children = library.childrenOf(folder).folders;
    return { label: basename(folder), checked: checked(folder), onSelect: move(folder), ...(children.length ? { items: children.map(branch) } : {}) };
  };
  const recents = recentFolders.filter((folder) => library.folders().has(folder));

  return {
    label: "Set folder",
    items: [
      ...recents.map((folder) => ({ label: basename(folder), checked: checked(folder), onSelect: move(folder) })),
      ...(recents.length ? [{ separator: true as const }] : []),
      { label: "All assets", checked: checked(""), onSelect: move("") },
      ...library.childrenOf("").folders.map(branch),
    ],
  };
}

export function Canvas(props: CanvasProps) {
  const world = useWorld();
  const actions = useObjectActions(usePromptInput().openPromptInput);

  const objectActions = (): ContextMenuExtra[] => {
    const media = actions.isImage() || actions.isVideo();
    const generated = media && actions.isGenerated();
    return [
      ...(actions.hasScene() ? [{ label: "Auto-Captions", onSelect: actions.autoCaptions }] : []),
      ...(actions.isImage() ? [{ label: "Remove background", checked: actions.isOn("removeBackground"), onSelect: () => actions.toggle("removeBackground") }] : []),
      ...(actions.isVideo() ? [{ label: "Add audio", checked: actions.isOn("addAudio"), onSelect: () => actions.toggle("addAudio") }] : []),
      ...(media ? [{ label: "Upscale", checked: actions.isOn("upscale"), onSelect: () => actions.toggle("upscale") }] : []),
      ...(actions.isImage() ? [{ label: "Edit with prompt", onSelect: actions.editWithPrompt }] : []),
      ...(generated && actions.isImage() ? [{ label: "Make video", onSelect: actions.makeVideo }] : []),
      ...(generated ? [{ label: "Rerun", onSelect: actions.rerun }] : []),
      ...(generated && actions.isImage() ? [{ label: "Reuse", onSelect: actions.reuse }] : []),
    ];
  };

  /**
   * Drops onto the canvas: library assets (dragged from the panel) land where
   * they were dropped, in the scene under the pointer; external files are
   * imported into the library first, then land the same way.
   *
   * With no scene under the pointer they land loose on the stage, like an
   * element drawn there (see DrawOverlay): the drop says where, so the active
   * scene — which is somewhere else entirely — is not the answer.
   */
  const handleDropEvent = async (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const library = world.get(Library);
    if (!library) return;

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const worldPt = screenToWorld(world, event.clientX - rect.left, event.clientY - rect.top);
    const scene = findSceneAt(world, worldPt.x, worldPt.y);
    const parent = scene ?? world.get(Root)!;
    const localPt = scene ? worldToLocal(world, scene, worldPt.x, worldPt.y) : worldPt;

    const place = (asset: Asset) => {
      const size = 'width' in asset && 'height' in asset ? { width: asset.width, height: asset.height } : { width: 500, height: 150 };
      const placed = insertAsset(world, asset, {
        parent,
        x: localPt.x - size.width / 2,
        y: localPt.y - size.height / 2,
      });
      if (!placed) toast("Nothing to insert into", { description: "Open a project first." });
    };

    const assetIds = event.dataTransfer?.getData(ASSET_DRAG_TYPE)?.split(',').filter(Boolean) ?? [];
    for (const id of assetIds) {
      const asset = library.get(id);
      if (asset) place(asset);
    }

    const files = droppedFiles(event);
    if (files.length) {
      for (const asset of await importFiles(library, files, '')) place(asset);
    }
  }

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }

  const handleContextMenu = (event: MouseEvent & { currentTarget: HTMLElement }) => {
    if (!(event.target instanceof HTMLCanvasElement)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = screenToWorld(world, event.clientX - rect.left, event.clientY - rect.top);
    const bounds = event.target.getBoundingClientRect();
    const resolution = world.get(RenderSurface)?.resolution ?? 1;
    const device = { x: (event.clientX - bounds.left) * resolution, y: (event.clientY - bounds.top) * resolution };
    const forkable = getSelection(world).find((entity) => isPointerInEntity(world, entity, device) && forkTemplate(entity));
    const library = world.get(Library);
    const onSelection = getSelection(world).some((entity) => isPointerInEntity(world, entity, device));
    const assets = onSelection ? selectionAssets(world) : [];
    const objectItems = onSelection ? objectActions() : [];
    offerContextMenuItems(event, [
      ...(onSelection && actions.canTidy() ? [{ label: "Tidy up", shortcut: "⌃⌥T", onSelect: actions.tidy }] : []),
      { label: "Add prompt", shortcut: "N", onSelect: () => insertPrompt(world, point) },
      ...(forkable ? [{ label: "Fork", shortcut: "⇧N", onSelect: () => forkPrompt(world, forkable) }] : []),
      ...(objectItems.length ? [{ separator: true as const }, { label: "Media actions", items: objectItems }] : []),
      ...(library && assets.length ? [
        { separator: true as const },
        setFolder(library, assets),
        { label: "Reveal in assets", shortcut: "⇧⌘O", onSelect: () => revealInAssets(world) },
        ...(finderPath(world) ? [{ label: "Reveal in finder", shortcut: "⌥⌘O", onSelect: () => revealInFinder(world) }] : []),
      ] : []),
    ]);
  };

  return (
    <div class="relative size-full bg-background" style={props.style}>
      <div
        class="absolute inset-0"
        on:drop={handleDropEvent}
        on:dragover={handleDragOver}
        onContextMenu={handleContextMenu}
      >
        <Toolbar />
        <DesktopAppBanner />
        <DrawOverlay />
        <SceneInitOverlay />
        <EngineCanvas />
        <PromptNodes />
        <CameraController />
      </div>
    </div>
  );
}
