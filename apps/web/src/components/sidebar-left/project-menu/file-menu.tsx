/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { useNavigate } from "@solidjs/router";
import { For, Show, createMemo } from "solid-js";
import { toast } from "somoto";
import { forgetProjectBundle, generateProjectName } from "@/lib/db";
import { createProject, deleteProject, duplicateProject, ensureProjectsRoot } from "@/projects";
import { AssetId, ChildOf, Name, Root, Scene, getAssetFile, getActiveEntity, sortByItemIndex } from "@diffusionstudio/runtime";
import { assetName } from "@diffusionstudio/assets";
import { useQuery, useWorld } from "@diffusionstudio/koota/solid";
import { useLibrary } from "@/engine/library";
import { pickAndImport } from "@/engine/asset-actions";
import { projectRoute } from "@/hooks/use-project-route";
import { useProject } from "@/context/project";
import { useExport } from "@/context/export";
import { getDefaultExportTemplate } from "@/components/sidebar-right/inspector/export-templates";
import { mimeTypeToExtension } from "@/utils";

import type { Entity } from "@diffusionstudio/koota";

export function FileMenu() {
  const navigate = useNavigate();
  const project = useProject();
  const library = useLibrary();

  const handleNewProject = async () => {
    try {
      if (!(await ensureProjectsRoot())) return;
      const created = await createProject(generateProjectName());
      navigate(projectRoute(created.id));
    } catch (e) {
      toast.error("Failed to create project", {
        description: (e as Error).message,
      });
    }
  };

  const handleDuplicateProject = async () => {
    try {
      const copy = await duplicateProject(project.dir());
      navigate(projectRoute(copy.id));
    } catch (e) {
      toast.error("Failed to duplicate project", { description: (e as Error).message });
    }
  };

  const handleDeleteProject = async () => {
    try {
      await deleteProject(project.dir());
      forgetProjectBundle(project.id());
      navigate("/?dashboard=projects");
    } catch (e) {
      toast.error("Failed to delete project", { description: (e as Error).message });
    }
  };

  const handleImportFromComputer = async () => {
    const lib = library();
    if (!lib) {
      toast("No project open");
      return;
    }
    await pickAndImport(lib, "");
  };

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={handleNewProject}>
          New project
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleDuplicateProject}>
          Duplicate project
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={handleImportFromComputer}>
          Import from computer...
          <DropdownMenuShortcut>⌘I</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Asset</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-[196px]">
              <FileAssetMenu />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Export</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-[246px]">
              <FileExportMenu />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={handleDeleteProject}>
          Delete project
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function FileAssetMenu() {
  const world = useWorld();
  const library = useLibrary();

  const handleDownloadAll = async () => {
    const all = library()?.list() ?? [];
    if (all.length === 0) {
      toast("No assets to download");
      return;
    }

    let destination: FileSystemDirectoryHandle;
    try {
      destination = await window.showDirectoryPicker({
        mode: "readwrite",
        startIn: "downloads",
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      toast.error("Failed to download assets", {
        description: (e as Error).message,
      });
      return;
    }

    try {
      const usedNames = new Set<string>();
      await Promise.all(
        all.map(async (asset) => {
          const file = await getAssetFile(asset);
          const assetFileName = assetName(asset);
          const base = assetFileName.match(/\.[^.]+$/)
            ? assetFileName
            : assetFileName + mimeTypeToExtension(asset.mimeType);

          let name = base;
          let i = 1;
          while (usedNames.has(name)) {
            const dot = base.lastIndexOf(".");
            name = dot === -1
              ? `${base} (${i})`
              : `${base.slice(0, dot)} (${i})${base.slice(dot)}`;
            i++;
          }
          usedNames.add(name);

          const fileHandle = await destination.getFileHandle(name, { create: true });
          const writable = await fileHandle.createWritable();
          try {
            await writable.write(file);
          } finally {
            await writable.close();
          }
        })
      );
      toast.success(`Downloaded ${all.length} asset${all.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error("Failed to download assets", {
        description: (e as Error).message,
      });
    }
  };

  const handleRemoveUnused = async () => {
    const lib = library();
    if (!lib) return;

    const referenced = new Set<string>();
    for (const entity of world.query(AssetId)) {
      const id = entity.get(AssetId)?.value;
      if (id) referenced.add(id);
    }

    const toRemove = lib.list().filter((asset) => !referenced.has(asset.id));
    if (toRemove.length === 0) {
      toast("No unused media found");
      return;
    }

    try {
      await lib.remove(toRemove);
      toast.success(
        `Removed ${toRemove.length} unused asset${toRemove.length === 1 ? "" : "s"}`
      );
    } catch (e) {
      toast.error("Failed to remove unused media", {
        description: (e as Error).message,
      });
    }
  };

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={handleDownloadAll}>
          Download all assets...
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={handleRemoveUnused}>
          Remove unused media...
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function FileExportMenu() {
  const world = useWorld();
  const { exportScene, exportCurrentFrame } = useExport();

  const handleExportScene = async () => {
    const scene = getActiveEntity(world);
    if (scene === null) {
      toast("No active scene to export");
      return;
    }
    await exportScene(scene, getDefaultExportTemplate());
  };

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={handleExportScene}>
          Export scene...
          <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Export specific scene</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-[172px]">
              <FileExportSpecificSceneMenu />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={() => exportCurrentFrame()}>
          Export current frame as image
          <DropdownMenuShortcut>⇧⌘E</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function FileExportSpecificSceneMenu() {
  const world = useWorld();
  const { exportScene } = useExport();

  // Scenes are top-level by definition; the order is the stage's, so the menu
  // reads the way the timeline's scene switcher does.
  const children = useQuery(Scene, ChildOf(world.get(Root)!));
  const scenes = createMemo(() => [...children()].sort(sortByItemIndex));

  const handleExport = async (scene: Entity) => {
    await exportScene(scene, getDefaultExportTemplate());
  };

  return (
    <DropdownMenuGroup>
      <Show
        when={scenes().length > 0}
        fallback={
          <DropdownMenuItem disabled>No scenes available</DropdownMenuItem>
        }
      >
        <For each={scenes()}>
          {(scene, index) => (
            <DropdownMenuItem onSelect={() => handleExport(scene)}>
              {scene.get(Name)?.value || `Scene ${index() + 1}`}
            </DropdownMenuItem>
          )}
        </For>
      </Show>
    </DropdownMenuGroup>
  );
}
