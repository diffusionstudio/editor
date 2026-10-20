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
import { useLocation, useNavigate } from "@solidjs/router";
import { For, Show, createMemo, createResource } from "solid-js";
import { toast } from "somoto";
import { forgetProjectBundle } from "@/lib/db";
import {
  createProject,
  deleteProject,
  duplicateProject,
  isWindowsDesktop,
  listProjects,
  openProjectFolder,
  pickProjectFolder,
  projectKey,
  projectsRevision,
} from "@/projects";
import { listEditors, openInEditor, revealPath } from "@/lib/shell";
import { AssetId, ChildOf, Name, Root, Scene, getActiveEntity, sortByItemIndex } from "@diffusionstudio/runtime";
import { assetName } from "@diffusionstudio/assets";
import { useQuery, useWorld } from "@diffusionstudio/koota-solid";
import { useLibrary } from "@/engine/library";
import { useAssetSelection } from "@/engine/hooks";
import { pickAndImport } from "@/engine/asset-actions";
import { projectRoute } from "@/hooks/use-project-route";
import { useProject } from "@/context/project";
import { useExport } from "@/context/export";
import { getDefaultExportTemplate } from "@/components/sidebar-right/inspector/export-templates";
import { openProjectFromList } from "@/components/dashboard/shared";
import { mimeTypeToExtension } from "@/utils";

import type { Entity } from "koota";
import type { EditorInfo } from "@/lib/shell";
import type { ProjectRecord } from "@/projects";

/** How many projects Open recent lists. */
const RECENT_PROJECTS = 10;

/**
 * The File commands that have a key as well as an item: the menu offers them,
 * and `ProjectMenu` binds their keys, since the menu is only mounted while open.
 */
export function useFileCommands() {
  const navigate = useNavigate();
  const location = useLocation();
  const project = useProject();

  const newProject = async () => {
    try {
      const created = await createProject();
      navigate(projectRoute(created.id), { state: location.state });
    } catch (e) {
      toast.error("Failed to create project", {
        description: (e as Error).message,
      });
    }
  };

  const openProject = async () => {
    try {
      const dir = await pickProjectFolder();
      if (!dir) return;
      const opened = await openProjectFolder(dir);
      navigate(projectRoute(projectKey(opened)), { state: location.state });
    } catch (e) {
      toast.error("Failed to open project", { description: (e as Error).message });
    }
  };

  const duplicate = async () => {
    try {
      const copy = await duplicateProject(project.dir());
      navigate(projectRoute(copy.id), { state: location.state });
    } catch (e) {
      toast.error("Failed to duplicate project", { description: (e as Error).message });
    }
  };

  return { newProject, openProject, duplicate };
}

export function FileMenu() {
  const navigate = useNavigate();
  const project = useProject();
  const library = useLibrary();
  const assetSelection = useAssetSelection();
  const commands = useFileCommands();
  const [editors] = createResource(listEditors, { initialValue: [] });

  const handleSave = async () => {
    try {
      await project.save();
    } catch (e) {
      toast.error("Failed to save project", { description: (e as Error).message });
    }
  };

  const handleMove = async () => {
    try {
      await project.move();
    } catch (e) {
      toast.error("Failed to move project", { description: (e as Error).message });
    }
  };

  const handleReveal = async () => {
    try {
      await revealPath(project.dir());
    } catch (e) {
      toast.error("Failed to show the folder", { description: (e as Error).message });
    }
  };

  const handleOpenInEditor = async (editor: EditorInfo) => {
    try {
      await openInEditor(editor.id, project.dir());
    } catch (e) {
      toast.error(`Failed to open in ${editor.label}`, { description: (e as Error).message });
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
    const imported = await pickAndImport(lib, "");

    if (imported.length) {
      assetSelection.set({
        ids: imported.map((asset) => asset.id),
        folders: [],
      });
    }
  };

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={commands.newProject}>
          New
          <DropdownMenuShortcut>⌘N</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={commands.openProject}>
          Open...
          <DropdownMenuShortcut>⌘O</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Open recent</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-[196px]">
              <FileRecentMenu />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={handleSave} disabled={!project.draft()}>
          Save...
          <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={commands.duplicate}>
          Duplicate...
          <DropdownMenuShortcut>⇧⌘S</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleMove} disabled={project.draft()}>
          Move to...
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={handleReveal}>
          {isWindowsDesktop() ? "Show in Explorer" : "Show in Finder"}
        </DropdownMenuItem>
        <For each={editors()}>
          {(editor) => (
            <DropdownMenuItem onSelect={() => handleOpenInEditor(editor)}>
              Open in {editor.label}
            </DropdownMenuItem>
          )}
        </For>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={handleImportFromComputer}>
          Import assets...
          <DropdownMenuShortcut>⌘I</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Assets</DropdownMenuSubTrigger>
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

/**
 * The projects opened last, the open one aside. Mounts with the submenu, so
 * the list is read when it opens.
 */
export function FileRecentMenu() {
  const navigate = useNavigate();
  const location = useLocation();
  const project = useProject();
  const [projects] = createResource(projectsRevision, listProjects, { initialValue: [] });
  const recent = createMemo(() =>
    projects().filter((record) => record.dir !== project.dir()).slice(0, RECENT_PROJECTS)
  );

  const handleOpen = async (record: ProjectRecord) => {
    const found = await openProjectFromList(record);
    if (!found) return;
    navigate(projectRoute(projectKey(found)), { state: location.state });
  };

  return (
    <DropdownMenuGroup>
      <For
        each={recent()}
        fallback={<DropdownMenuItem disabled>No recent projects</DropdownMenuItem>}
      >
        {(record) => (
          <DropdownMenuItem onSelect={() => handleOpen(record)}>
            <span class="min-w-0 flex-1 truncate">{record.displayName}</span>
          </DropdownMenuItem>
        )}
      </For>
    </DropdownMenuGroup>
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
          const file = await asset.handle.getOriginal();
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
