/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createContext, useContext, onCleanup } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useWorld } from "@diffusionstudio/koota-solid";
import { Project } from "@diffusionstudio/runtime";
import { DapiError } from "@diffusionstudio/dapi";
import { useProject } from "@/context/project";
import { useAuth } from "@/context/auth";
import { useEngineContext } from "@/engine";
import { openProjectFolder } from "@/projects";
import { projectRoute } from "@/hooks/use-project-route";
import { useFullscreenState } from "@/hooks/use-fullscreen-state";
import { assert } from "@/utils/common";
import { cliBridge } from "./bridge";
import { handlers } from "./handlers";
import { editorSession, requireEditorSession, setEditorSession } from "./session";

import type { JSX, Accessor } from "solid-js";
import type { ToolContext } from "./handler";

type EditorApiContextValue = {
  isFullscreen: Accessor<boolean>;
  isDesktop: boolean;
};

const EditorApiContext = createContext<EditorApiContextValue>();

/**
 * Registers the tool handlers for as long as the app runs. Every tool is
 * reachable whether or not a project is open; the ones that need one read
 * the session slot (see ./session) per call and fail with a clear error —
 * or, for `context`, report that nothing is open. Renders nothing; must sit
 * inside the router tree for `useNavigate` and inside the auth provider.
 */
export function EditorApi() {
  const navigate = useNavigate();
  const auth = useAuth();

  const context = (signal: AbortSignal): ToolContext => ({
    session: editorSession,
    requireSession: requireEditorSession,
    signal,
    app: {
      async openProject(dir) {
        const project = await openProjectFolder(dir);
        navigate(projectRoute(project.id || project.name));
        return { id: project.id, name: project.displayName, dir: project.dir };
      },
      user: () => auth.user() ?? null,
      requireUser() {
        const user = auth.user();
        if (!user) throw new DapiError("sign-in-required", "Sign in required: AI generation needs a Diffusion Studio account.");
        return user;
      },
    },
  });

  onCleanup(cliBridge.register(handlers, context));
  return null;
}

/**
 * Publishes the editor session for the tool handlers while the project is
 * open, and provides the editor UI's own view of the app shell (fullscreen
 * state, desktop-ness). Mounted per project page.
 */
export function EditorApiProvider(props: { children: JSX.Element }) {
  const project = useProject();
  const isFullscreen = useFullscreenState();
  const world = useWorld();
  const engine = useEngineContext();

  createEffect(() => {
    if (!window.desktop || project.id() !== world.get(Project)?.id) return;

    setEditorSession({ world, project, engine });
    onCleanup(() => setEditorSession(null));
  });

  return (
    <EditorApiContext.Provider value={{ isFullscreen, isDesktop: !!window.desktop }}>
      {props.children}
    </EditorApiContext.Provider>
  );
}

export function useEditorApi() {
  const ctx = useContext(EditorApiContext);
  assert(ctx, "useEditorApi must be used within EditorApiProvider");
  return ctx;
}
