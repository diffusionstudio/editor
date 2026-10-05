/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, type JSX } from "solid-js";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useAuth } from "@/context/auth";
import { useAvatar } from "@/hooks/use-avatar";
import { cx } from "@/lib/cva";
import { planName } from "@/lib/checkout";

type DashboardSidebarItemProps = {
  icon: string;
  label: string;
  active?: boolean;
  onClick?(): void;
  class?: string;
};

export function DashboardSidebarItem(props: DashboardSidebarItemProps) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class={cx(
        "my-0.5 flex h-7 w-full shrink-0 items-center gap-1 rounded-md pl-0 pr-1 hover:bg-accent focus-ring",
        props.class,
      )}
      classList={{ "bg-accent": props.active }}
    >
      <span class="grid size-7 shrink-0 place-items-center overflow-clip">
        <Show
          when={props.active}
          fallback={<Icon name={props.icon} class="size-6 text-muted-foreground" />}
        >
          <Icon name={props.icon} class="size-6 text-foreground" />
        </Show>
      </span>
      <span
        class="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground"
        classList={{ "text-foreground": props.active }}
      >
        {props.label}
      </span>
    </button>
  );
}

export function DashboardSidebarHeader() {
  return (
    // Extra top padding on the macOS desktop build clears the traffic lights
    // (hiddenInset title bar), except in fullscreen where they are gone.
    <div class="flex flex-col items-start gap-3 p-4 [[data-platform=darwin]:not([data-fullscreen=true])_&]:pt-14">
      <Icon name="diffusion-logo-large" class="size-6 text-muted-foreground" />
      <div class="flex w-full flex-col items-start gap-1 text-muted-foreground">
        <p class="w-full text-2xl leading-5 font-450 text-muted-foreground">
          Diffusion Studio
        </p>
        <div class="flex w-full items-center py-0.5">
          <p class="w-full overflow-hidden text-xxs whitespace-nowrap text-ellipsis text-muted-foreground opacity-50">
            v{APP_VERSION}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The header on the Windows desktop build: one row at the height of the native
 * window controls, which reads as the left end of the title bar.
 */
export function DashboardSidebarTitleBar() {
  return (
    <div class="flex h-10 shrink-0 items-center gap-2 pl-3 pr-4">
      <Icon name="diffusion-logo" class="size-6 shrink-0 text-muted-foreground" />
      <p class="min-w-0 flex-1 truncate text-xs font-450 text-muted-foreground">Diffusion Studio</p>
      <p class="shrink-0 text-xxs text-muted-foreground">v{APP_VERSION}</p>
    </div>
  );
}

/**
 * Stands in for the header when the sidebar has none. On the macOS desktop
 * build it clears the traffic lights (hiddenInset title bar), except in
 * fullscreen where they are gone.
 */
export function DashboardSidebarTopSpacer() {
  return <div class="h-4 shrink-0 [[data-platform=darwin]:not([data-fullscreen=true])_&]:h-12" />;
}

type DashboardSidebarNavProps = {
  children: JSX.Element;
  footer?: JSX.Element;
};

/** The scrolling middle of the sidebar: stacked sections, then empty space. */
export function DashboardSidebarNav(props: DashboardSidebarNavProps) {
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2 px-3">
      {props.children}
      <div class="min-h-0 flex-1" />
      {props.footer}
    </div>
  );
}

type DashboardSidebarConnectCardProps = {
  onInstall: () => void;
};

/** The nudge towards the agent setup, shown until an agent is connected. */
export function DashboardSidebarConnectCard(props: DashboardSidebarConnectCardProps) {
  return (
    <div class="flex w-full shrink-0 flex-col items-center gap-1 rounded-md bg-accent py-3">
      <div class="flex w-full flex-col gap-3 px-3">
        <div class="flex w-full flex-col gap-1">
          <div class="flex w-full items-center pb-0.5">
            <p class="min-w-0 flex-1 truncate text-xs font-450 text-foreground">Connect your agent</p>
          </div>
          <p class="w-full text-xs text-muted-foreground">
            Edit your videos with coding agents like Claude Code, Codex, or Cursor.
          </p>
        </div>
        <Button variant="secondary" class="w-full" onClick={props.onInstall}>
          Install agent tools
        </Button>
      </div>
    </div>
  );
}

type DashboardSidebarSectionProps = {
  title?: string;
  children: JSX.Element;
};

export function DashboardSidebarSection(props: DashboardSidebarSectionProps) {
  return (
    <div class="flex shrink-0 flex-col">
      <Show when={props.title}>
        <div class="flex h-8 shrink-0 items-center px-1">
          <p class="text-xs text-muted-foreground">{props.title}</p>
        </div>
      </Show>
      {props.children}
    </div>
  );
}

type DashboardSidebarUserProps = {
  onClick: () => void;
};

export function DashboardSidebarUser(props: DashboardSidebarUserProps) {
  const auth = useAuth();

  const displayName = () => {
    const user = auth.user();
    return user?.user_metadata?.full_name || user?.email || "User";
  };

  const planLabel = () => `${planName(auth.plan())} Plan`;

  const initial = () => displayName().charAt(0).toUpperCase();
  const avatarUrl = useAvatar();

  return (
    <div class="p-2">
      <button
        type="button"
        onClick={props.onClick}
        class="flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-accent focus-ring"
      >
        <Show
          when={avatarUrl()}
          fallback={
            <div class="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-xs text-foreground">
              {initial()}
            </div>
          }
        >
          {(url) => (
            <img
              src={url()}
              alt=""
              class="size-8 shrink-0 rounded-full object-cover"
            />
          )}
        </Show>
        <div class="flex min-w-0 flex-1 flex-col justify-center">
          <span class="truncate text-xs font-450 text-foreground">
            {displayName()}
          </span>
          <span class="truncate text-xxs text-muted-foreground">
            {planLabel()}
          </span>
        </div>
        <Icon name="settings" class="size-6 shrink-0 text-muted-foreground" />
      </button>
    </div>
  );
}
