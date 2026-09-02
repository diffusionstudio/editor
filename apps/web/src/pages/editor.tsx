/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createMemo, createSignal } from "solid-js";
import { Canvas } from "@/components/canvas";
import { Timeline, Layers } from "@/components/timeline";
import { Soundboard, Inspector } from "@/components/sidebar-right";
import { FloatingProjectHeader, SidebarLeft } from "@/components/sidebar-left";
import { useLayout, MIN_TIMELINE_HEIGHT } from "@/context/layout";
import { useEditorApi } from "@/context/dapi";
import { RULER_HEIGHT } from "@/engine/timeline";
import { createEffect, onCleanup, untrack } from 'solid-js';
import { toast } from 'somoto';
import { useWorld } from '@diffusionstudio/koota-solid';
import { mount } from '@diffusionstudio/reconciler';
import { getDocumentEditor } from '@/engine/editor';
import { getEditHistory } from '@/engine/history';
import { setInspectEntries } from '@/engine/inspect';
import { attachLibrary, isLibraryFile } from '@/engine/library';
import { attachAi } from '@/utils/gen-ai';
import { attachProjectConfig, isProjectConfigFile } from '@/engine/project-config';
import { loadProjectBundle, rememberProjectBundle } from '@/lib/db';
import { isCacheFile } from '@diffusionstudio/assets';
import { Paint, PaintType } from '@diffusionstudio/runtime';
import { createEditWriter } from '@/projects/edits';
import { compileProject, reportProjectBundleApplied, watchProject } from '@/projects/host';
import { captureProjectCover } from '@/projects/cover';
import { useProject } from "@/context/project";
import { useEngineContext } from "@/engine";
import { BrowserCompanionIndicator, BrowserCompanionSemanticReporter } from "@/components/browser-companion-indicator";

import type { Mount } from '@diffusionstudio/reconciler';
import type { EditWriter } from '@/projects/edits';
import { isBrowserCompanionRenderer } from '@/lib/companion-authority';
import { documentMutationsEnabled } from '@/lib/companion-capabilities';

const MIN_CANVAS_HEIGHT = 200;

export function EditorPage() {
  const { uiVisible, timelineMinimized, timelineHeight, setTimelineHeight } = useLayout();
  const { isDesktop, isFullscreen } = useEditorApi();
  const [resizing, setResizing] = createSignal(false);
  const project = useProject();
  const world = useWorld();
  const engine = useEngineContext();

  // Keyed on the folder, not the project: a rename moves it, and everything
  // below holds a path — the watcher, the library, the writer — so all of it
  // is torn down and re-attached where the project now is.
  createEffect(() => {
    const dir = project.dir();
    if (!dir) return;

    let mounted: Mount | undefined;
    let mountedCode: string | undefined;
    let writer: EditWriter | undefined;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    let generation = 0;

    // The library first: a mounted project's `src` values name its assets.
    const library = attachLibrary(world, dir);
    // The generation service over it: what `generate.*` sources resolve through.
    attachAi(world, library, dir);
    // The project's own settings (package.json `diffusion`), next to the scene.
    const config = attachProjectConfig(world, dir);

    const unmount = (): void => {
      // Before the entities go: what the editor changed is still owed to the
      // file, whatever happens to the scene that showed it.
      unlisten?.();
      unlisten = undefined;
      writer?.dispose();
      writer = undefined;
      mounted?.dispose();
      mounted = undefined;
      mountedCode = undefined;
      // The entries hold the dead mount's signals; the inspector must not.
      setInspectEntries(world, []);
    };

    /** Puts `code` on the stage, unless it is what is there already. */
    const applyBundle = (code: string): void => {
      if (code === mountedCode) return;
      // The old render goes first: there is only one stage per world.
      unmount();
      mounted = mount(code, world);
      if (isBrowserCompanionRenderer() && world.query(Paint).some((entity) => entity.get(Paint)?.value === PaintType.HTML)) {
        mounted.dispose();
        mounted = undefined;
        throw new Error(
          "This project contains <html>/<htmlPaint> content, which requires Chromium's experimental CanvasDrawElement API. " +
          "The browser gateway fails closed instead of silently misrendering it; use the Electron app for this project.",
        );
      }
      mountedCode = code;
      // The `@inspect` variables this mount declared, for the inspector.
      setInspectEntries(world, mounted.inspect);
      // The rendered scene knows which element every entity came from, so
      // from here on an edit in the editor can find its way back.
      if (documentMutationsEnabled()) {
        writer = createEditWriter(dir, world);
        const editor = getDocumentEditor(world);
        unlisten = editor.onEdit((edit) => writer?.push(edit));
      }
      // A mount comes from the file: edits recorded against the document it
      // replaced cannot be replayed against this one.
      getEditHistory(world).reset();
    };

    const loadProject = async (): Promise<void> => {
      const current = ++generation;
      // Only the editor surface's compile can advance companion readiness.
      // Offline capture/export compiles use the same compiler but never mount
      // this world and therefore must not be published as surface revisions.
      const compiling = compileProject(dir, { companionSurfaceMount: true });
      const loading = library.load();

      // First open only: the bundle the last session mounted, straight from
      // the app's database, goes on the stage while the compile chews
      // through the sources — unless the compile wins the race outright. A
      // bundle the sources have outgrown can fail against today's assets;
      // the compile that is already running replaces it either way.
      if (current === 1) {
        // Neither arm may reject: the loser would be an unhandled rejection,
        // and the compile's real failure is dealt with below.
        const cached = await Promise.race([
          Promise.all([loadProjectBundle(untrack(project.id)), loading])
            .then(([code]) => code, () => null),
          compiling.then(() => null, () => null),
        ]);
        if (disposed || current !== generation) return;
        if (cached && mountedCode === undefined) {
          try {
            applyBundle(cached);
          } catch {
            // The compile lands next, with a toast of its own if it must.
          }
        }
      }

      const [result] = await Promise.all([compiling, loading]);
      if (disposed || current !== generation) return;

      // A broken edit keeps the last good render on the canvas.
      if (!result.ok) {
        console.error('[projects] compile failed:', result.error);
        toast.error('Project failed to compile', { description: result.error });
        return;
      }

      try {
        applyBundle(result.code);
        await reportProjectBundleApplied(dir, result, true);
        // What an export renders a second time, and the next open's head
        // start (see `rememberProjectBundle`) — recorded only once it has
        // actually mounted, so the record never runs ahead of the canvas.
        rememberProjectBundle(untrack(project.id), result.code).catch((error) =>
          console.error('[projects] could not save the bundle', error));
      } catch (error) {
        await reportProjectBundleApplied(dir, result, false, (error as Error).message).catch((reportError) =>
          console.error('[projects] could not report bundle mount failure', reportError));
        console.error('[projects] render failed:', error);
        toast.error('Project failed to render', { description: (error as Error).message });
      }
    };

    const load = (): void => {
      loadProject().catch((error) => {
        console.error('[projects] load failed:', error);
        toast.error('Project failed to load', { description: (error as Error).message });
      });
    };

    load();
  
    const unwatch = watchProject(dir, (path) => {
      if (isCacheFile(path)) return;
      if (isLibraryFile(path)) {
        library.load();
      } else {
        // package.json is the config and the record (`main`, `displayName`)
        // in one, so a hand edit to it reloads both; the app's own config
        // writes never reach here (main keeps them from the watcher).
        if (isProjectConfigFile(path)) {
          config.load();
          void project.refresh();
        }
        load();
      }
    });

    onCleanup(() => {
      disposed = true;
      captureProjectCover(dir, engine.snapshot());
      unwatch();
      unmount();
      config.dispose();
      library.dispose();
    });
  });

  const timelineStyles = createMemo(() => {
    if (!uiVisible()) return;

    const height = timelineMinimized() ? RULER_HEIGHT : timelineHeight();

    return {
      'grid-template-rows': `1fr 1px ${height}px`,
    };
  });

  const handleResizeStart = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startHeight = timelineHeight();
    setResizing(true);

    const handleMove = (ev: PointerEvent) => {
      const deltaY = startY - ev.clientY;
      const maxHeight = Math.max(
        MIN_TIMELINE_HEIGHT,
        window.innerHeight - MIN_CANVAS_HEIGHT - 1,
      );
      const next = Math.max(MIN_TIMELINE_HEIGHT, Math.min(maxHeight, startHeight + deltaY));
      setTimelineHeight(next);
    };

    const handleEnd = () => {
      setResizing(false);
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleEnd);
    };

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleEnd);
  };

  return (
    <div
      class="bg-sidebar h-screen w-full overflow-hidden grid"
      classList={{
        'grid-cols-[264px_1px_1fr_1px_264px]': uiVisible(),
        'grid-cols-[1fr]': !uiVisible(),
        'grid-rows-[1fr]': !uiVisible(),
      }}
      style={timelineStyles()}
    >
      <BrowserCompanionIndicator />
      <BrowserCompanionSemanticReporter />
      <Show when={isDesktop && !isFullscreen()}>
        <div class="fixed top-0 left-0 right-0 h-10 z-20" style="-webkit-app-region: drag;" />
      </Show>
      <Show when={uiVisible()}>
        <SidebarLeft />
        <div class="bg-border-strong" />
      </Show>
      <Canvas />
      <Show when={uiVisible()}>
        <div class="bg-border-strong" />
        <Inspector />
      </Show>
      <Show when={uiVisible()}>
        <div class="col-span-full bg-border-strong relative">
          <Show when={!timelineMinimized()}>
            <div
              class="absolute left-0 right-0 -top-px h-0.75 z-10 cursor-ns-resize group"
              onPointerDown={handleResizeStart}
            >
              <div
                class="absolute left-0 right-0 top-px h-px transition-colors group-hover:bg-primary"
                classList={{ 'bg-primary': resizing() }}
              />
            </div>
          </Show>
        </div>
      </Show>
      <Show when={uiVisible()}>
        <Layers />
        <div class="bg-border-strong" />
      </Show>
      <Show when={uiVisible()}>
        <Timeline />
      </Show>
      <Show when={uiVisible()}>
        <div class="bg-border-strong" />
        <Show when={!timelineMinimized()}>
          <Soundboard />
        </Show>
      </Show>
      <Show when={!uiVisible()}>
        <FloatingProjectHeader />
      </Show>
    </div>
  );
}
