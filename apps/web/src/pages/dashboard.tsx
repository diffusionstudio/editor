/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { Match, Show, Switch, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { toast } from "somoto";

import { DashboardAccountView } from "@/components/dashboard/account-view";
import { DashboardAiCreditsView } from "@/components/dashboard/ai-credits-view";
import { DashboardBillingView } from "@/components/dashboard/billing-view";
import { DashboardGetDesktopApp } from "@/components/dashboard/get-desktop-app";
import { DashboardHelpView } from "@/components/dashboard/help-view";
import { DashboardHomeView } from "@/components/dashboard/home-view";
import { DashboardMcpView } from "@/components/dashboard/mcp-view";
import { DashboardProjectsView } from "@/components/dashboard/projects-view";
import { DashboardSettingsView } from "@/components/dashboard/settings-view";
import {
  DashboardSidebarConnectCard,
  DashboardSidebarHeader,
  DashboardSidebarItem,
  DashboardSidebarNav,
  DashboardSidebarSection,
  DashboardSidebarTitleBar,
  DashboardSidebarTopSpacer,
  DashboardSidebarUser,
} from "@/components/dashboard/sidebar";
import { Separator } from "@/components/ui/separator";
import { useFullscreenState } from "@/hooks/use-fullscreen-state";
import { connectedAgents, fetchMcpStatus } from "@/lib/mcp";
import { isDesktop, isWindowsDesktop, openProjectFolder, pickProjectFolder } from "@/projects";
import { isInputTarget } from "@/utils";

import type { DashboardView } from "@/components/dashboard/types";

const DASHBOARD_VIEWS: readonly DashboardView[] = [
  "home",
  "projects",
  "templates",
  "ai-credits",
  "billing",
  "account",
  "settings",
  "mcp",
  "preferences",
  "help",
];

/** The views reached through the settings navigation, not the dashboard one. */
const SETTINGS_VIEWS: readonly DashboardView[] = [
  "account",
  "settings",
  "mcp",
  "ai-credits",
  "billing",
  "help",
];

function parseView(value: string | string[] | undefined): DashboardView {
  const raw = Array.isArray(value) ? value[0] : value;
  return DASHBOARD_VIEWS.find((v) => v === raw) ?? "home";
}

function isSettingsView(view: DashboardView): boolean {
  return SETTINGS_VIEWS.includes(view);
}

export function DashboardPage() {
  const [params, setParams] = useSearchParams();
  const isFullscreen = useFullscreenState();

  // ⌘I: the native folder picker, and the chosen folder on the recents list.
  let picking = false;
  const handleShortcut = async (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
    if (event.key.toLowerCase() !== "i" || isInputTarget(event)) return;

    event.preventDefault();
    if (picking || !isDesktop()) return;
    picking = true;

    try {
      const dir = await pickProjectFolder();
      if (!dir) return;
      await openProjectFolder(dir);
    } catch (e) {
      toast.error("Failed to add project", { description: (e as Error).message });
    } finally {
      picking = false;
    }
  };

  onMount(() => {
    window.addEventListener("keydown", handleShortcut);
    onCleanup(() => window.removeEventListener("keydown", handleShortcut));
  });

  const view = (): DashboardView => parseView(params.dashboard);
  const setView = (next: DashboardView) => setParams({ dashboard: next }, { replace: true });

  // Which navigation the sidebar shows. Landing on a settings view (deep link,
  // reload) opens the settings navigation; the user row opens it by itself.
  const [settingsNavOpen, setSettingsNavOpen] = createSignal(isSettingsView(view()));

  createEffect(() => {
    if (isSettingsView(view())) {
      setSettingsNavOpen(true);
    }
  });

  const openProfile = () => {
    setSettingsNavOpen(true);
    setView("account");
  };
  const openAgentSetup = () => {
    setSettingsNavOpen(true);
    setView("mcp");
  };

  onMount(() => fetchMcpStatus().catch(() => { }));

  const showConnectCard = () => isDesktop() && connectedAgents() === 0;

  const backToDashboard = () => {
    setSettingsNavOpen(false);
    if (isSettingsView(view())) setView("home");
  };

  return (
    <div class="flex h-screen w-full min-h-0 flex-row overflow-hidden bg-sidebar">
      <aside class="relative flex min-h-0 w-69 shrink-0 flex-col">
        <Show when={!!window.desktop && !isFullscreen()}>
          <div class="absolute inset-x-0 top-0 h-10 z-20" style="-webkit-app-region: drag;" />
        </Show>
        <Show when={!isWindowsDesktop()} fallback={<DashboardSidebarTitleBar />}>
          <Show when={!settingsNavOpen()} fallback={<DashboardSidebarTopSpacer />}>
            <DashboardSidebarHeader />
          </Show>
        </Show>
        <DashboardSidebarNav
          footer={
            <Show when={!settingsNavOpen() && showConnectCard()}>
              <DashboardSidebarConnectCard onInstall={openAgentSetup} />
            </Show>
          }
        >
          <Show
            when={settingsNavOpen()}
            fallback={
              <DashboardSidebarSection>
                <DashboardSidebarItem active={view() === "home"} onClick={() => setView("home")} icon="home" label="Home" />
                <DashboardSidebarItem active={view() === "projects"} onClick={() => setView("projects")} icon="diffusion-project-file" label="Projects" />
              </DashboardSidebarSection>
            }
          >
            <DashboardSidebarSection>
              <DashboardSidebarItem onClick={backToDashboard} icon="arrow-left" label="Back to dashboard" />
            </DashboardSidebarSection>
            <DashboardSidebarSection title="Settings">
              <DashboardSidebarItem active={view() === "account"} onClick={() => setView("account")} icon="user" label="Account" />
              <DashboardSidebarItem active={view() === "settings"} onClick={() => setView("settings")} icon="settings" label="General" />
              <DashboardSidebarItem active={view() === "mcp"} onClick={() => setView("mcp")} icon="ai-mcp-cli" label="MCP & CLI" />
              <DashboardSidebarItem active={view() === "ai-credits"} onClick={() => setView("ai-credits")} icon="ai-credits" label="AI credits" />
              <DashboardSidebarItem active={view() === "billing"} onClick={() => setView("billing")} icon="billing" label="Billing" />
              <DashboardSidebarItem active={view() === "help"} onClick={() => setView("help")} icon="help" label="Help" />
            </DashboardSidebarSection>
          </Show>
        </DashboardSidebarNav>
        <Show when={!settingsNavOpen()}>
          <DashboardSidebarUser onClick={openProfile} />
        </Show>
      </aside>

      <Separator orientation="vertical" class="bg-border-strong" />

      <section class="flex min-h-0 flex-1 flex-col bg-overlay-soft">
        <Switch>
          <Match when={view() === "home"}>
            <DashboardHomeView />
          </Match>
          <Match when={view() === "projects"}>
            <DashboardProjectsView />
          </Match>
          <Match when={view() === "ai-credits"}>
            <DashboardAiCreditsView />
          </Match>
          <Match when={view() === "billing"}>
            <DashboardBillingView />
          </Match>
          <Match when={view() === "account"}>
            <DashboardAccountView />
          </Match>
          <Match when={view() === "settings"}>
            <DashboardSettingsView />
          </Match>
          <Match when={view() === "mcp"}>
            <DashboardMcpView />
          </Match>
          <Match when={view() === "help"}>
            <DashboardHelpView />
          </Match>
        </Switch>
        <DashboardGetDesktopApp />
      </section>
    </div>
  );
}
