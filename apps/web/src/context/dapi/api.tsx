/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createContext, useContext, onCleanup } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useWorld } from '@diffusionstudio/koota/solid';
import { Project } from '@diffusionstudio/runtime';
import { useProject } from '@/context/project';
import { useAuth } from '@/context/auth';
import { t, q, q0, m } from "@/lib/cli-rpc";
import { editorSession, requireEditorSession, setEditorSession } from "./session";
import { handleContextGet } from "./context";
import { createAssetResolver, handleMediaProbe, handleMediaFrame, handleMediaTranscribe, handleMediaFilmstrip, handleMediaWaveform, handleMediaListen } from "./media";
import { handleCapture } from "./capture";
import { handleCheck } from "./check";
import { handleLogs } from "./logs";
import { handleModels } from "./models";
import { handleVoices } from "./voices";
import { cliBridge } from '@/lib/ipc';
import { createRouterCaller } from '@/lib/cli-rpc';
import { openProjectFolder } from '@/projects';
import { projectRoute } from '@/hooks/use-project-route';
import { assert } from "@/utils/common";
import { handleWindowScreenshot } from "./window";
import { useFullscreenState } from "@/hooks/use-fullscreen-state";

import type { JSX, Accessor } from 'solid-js';
import type { Navigator } from '@solidjs/router';
import type { User } from '@supabase/supabase-js';

type EditorApiProviderProps = {
  children: JSX.Element;
};

type EditorApiContextValue = {
  isFullscreen: Accessor<boolean>;
  isDesktop: boolean;
};

const EditorApiContext = createContext<EditorApiContextValue>();

/**
 * The one CLI router, registered for as long as the app runs. Every endpoint
 * is reachable whether or not a project is open; the ones that need one read
 * the session slot (see ./session) per request and fail with a clear error —
 * or, for `context`, report that nothing is open. Renders nothing; must sit
 * inside the router tree for `useNavigate` and inside the auth provider.
 */
export function EditorApi() {
  const navigate = useNavigate();
  const auth = useAuth();

  const requireAuth = <I, O>(fn: (data: I) => Promise<O>) => (data: I) => {
    assert(auth.isAuthenticated(), "Sign in required: AI generation needs a Diffusion Studio account.");
    return fn(data);
  };

  const getUser = () => {
    const user = auth.user();
    assert(user, "User not found");
    return user;
  };

  const router = createAppRouter({ navigate, getUser, requireAuth });
  onCleanup(cliBridge.register(createRouterCaller(router)));
  return null;
}

/**
 * Publishes the editor session for the CLI router while the project is open,
 * and provides the editor UI's own view of the app shell (fullscreen state,
 * desktop-ness). Mounted per project page.
 */
export function EditorApiProvider(props: EditorApiProviderProps) {
  const project = useProject();
  const isFullscreen = useFullscreenState();
  const world = useWorld();

  createEffect(() => {
    if (!window.desktop || project.id() !== world.get(Project)?.id) return;

    setEditorSession({ world, project });
    onCleanup(() => setEditorSession(null));
  });

  return (
    <EditorApiContext.Provider
      value={{
        isFullscreen,
        isDesktop: !!window.desktop,
      }}
    >
      {props.children}
    </EditorApiContext.Provider>
  );
}


type AppRouterDeps = {
  navigate: Navigator;
  getUser: () => User;
  requireAuth: <I, O>(fn: (data: I) => Promise<O>) => (data: I) => Promise<O>;
};

function createAppRouter({ navigate, getUser, requireAuth }: AppRouterDeps) {
  const resolveAsset = createAssetResolver(editorSession);

  return t.router({
    ping: t.procedure.query(() => {}),
    open: m(async ({ dir }: { dir: string }) => {
      const project = await openProjectFolder(dir);
      navigate(projectRoute(project.id || project.name));
      return { id: project.id, name: project.displayName, dir: project.dir };
    }),
    whoami: t.procedure.query(() => getUser()),
    context: q0(handleContextGet(editorSession)),
    capture: q(handleCapture(requireEditorSession)),
    check: q(handleCheck(requireEditorSession)),
    models: q(handleModels()),
    logs: q(handleLogs()),
    screenshot: q0(handleWindowScreenshot()),
    voices: q0(handleVoices()),
    media: t.router({
      probe: q(handleMediaProbe(resolveAsset)),
      frame: q(handleMediaFrame(resolveAsset)),
      transcribe: q(handleMediaTranscribe(resolveAsset)),
      filmstrip: q(handleMediaFilmstrip(resolveAsset)),
      waveform: q(handleMediaWaveform(resolveAsset)),
      listen: q(requireAuth(handleMediaListen(resolveAsset, editorSession))),
    }),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

export function useEditorApi() {
  const ctx = useContext(EditorApiContext);
  assert(ctx, "useEditorApi must be used within EditorApiProvider");
  return ctx;
}
