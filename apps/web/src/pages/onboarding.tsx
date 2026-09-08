/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal, onMount, Show } from 'solid-js';
import type { JSX } from 'solid-js';
import { toast } from 'somoto';

import { MAIN_CHANNELS } from '@desktop/main-channels';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { downloadDesktopApp } from '@/lib/desktop-app';
import { createStoredSignal } from '@/lib/store';
import { mainBridge } from '@/lib/ipc';
import { track } from '@/lib/analytics';
import { store } from '@/init';

const [onboardingCompleted, setOnboardingCompleted] = createStoredSignal(
  store.define('onboarding.completed', false),
);

export { onboardingCompleted };

type StepState = 'todo' | 'busy' | 'done';

type SetupRowProps = {
  title: string;
  description: string;
  action: JSX.Element;
};

function SetupRow(props: SetupRowProps) {
  return (
    <div class="flex items-center gap-4">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <p class="text-xs text-foreground">{props.title}</p>
        <p class="text-xs text-muted-foreground">{props.description}</p>
      </div>
      {props.action}
    </div>
  );
}

type StepButtonProps = {
  state: StepState;
  label: string;
  busyLabel?: string;
  doneLabel: string;
  onClick: () => void;
};

function StepButton(props: StepButtonProps) {
  return (
    <Show
      when={props.state !== 'done'}
      fallback={
        <Button variant="on" class="pointer-events-none">
          {props.doneLabel}
        </Button>
      }
    >
      <Button
        variant="secondary"
        disabled={props.state === 'busy'}
        onClick={props.onClick}
      >
        {props.state === 'busy' ? props.busyLabel ?? props.label : props.label}
      </Button>
    </Show>
  );
}

/**
 * Post-signup screen for connecting agents to the app: its MCP server, which
 * carries the tools and the authoring reference, and the dapi CLI. Shown by
 * AuthGate until dismissed; the dismissal is per-device (same store as the
 * promo banners).
 *
 * On desktop there are two agent steps, both via main and both also in the
 * app menu: registering the bundled `dapi mcp` with the agents on this
 * machine, and linking the `dapi` binary into PATH for shells and scripts.
 * On the web, where neither exists, one row offers the desktop app instead.
 */
export function OnboardingPage() {
  const isDesktop = !!window.desktop;
  const [mcpState, setMcpState] = createSignal<StepState>('todo');
  const [cliState, setCliState] = createSignal<StepState>('todo');

  onMount(async () => {
    if (!isDesktop) return;
    try {
      const [mcp, cli] = await Promise.all([
        mainBridge.call(MAIN_CHANNELS.MCP_IS_REGISTERED, undefined),
        mainBridge.call(MAIN_CHANNELS.CLI_IS_INSTALLED, undefined),
      ]);
      if (mcp) setMcpState('done');
      if (cli) setCliState('done');
    } catch {
      // Can't tell — leave the install buttons available.
    }
  });

  const registerMcp = async () => {
    setMcpState('busy');
    try {
      const result = await mainBridge.call(MAIN_CHANNELS.MCP_REGISTER, undefined);
      if (result.status === 'registered') {
        track('onboarding_mcp_registered', { agents: result.agents.join(',') });
        setMcpState('done');
        toast('Connected', {
          description: `Registered with ${result.agents.join(', ')}. Restart the agent to pick it up.`,
        });
      } else {
        setMcpState('todo');
        toast('Could not connect your agents', { description: result.error });
      }
    } catch (error) {
      setMcpState('todo');
      toast('Could not connect your agents', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  const installCli = async () => {
    setCliState('busy');
    try {
      const result = await mainBridge.call(MAIN_CHANNELS.CLI_INSTALL, undefined);
      if (result.status === 'installed') {
        track('onboarding_cli_installed');
        setCliState('done');
      } else {
        setCliState('todo');
        if (result.status === 'error') {
          toast('Could not install the dapi CLI', { description: result.error });
        }
      }
    } catch (error) {
      setCliState('todo');
      toast('Could not install the dapi CLI', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  // The web has one row for both: the server and the CLI ship with the app.
  const downloadApp = () => {
    downloadDesktopApp('onboarding');
    setMcpState('done');
    setCliState('done');
  };

  const allDone = () => mcpState() === 'done' && cliState() === 'done';

  const finish = (event: 'onboarding_completed' | 'onboarding_skipped') => {
    track(event);
    setOnboardingCompleted(true);
  };

  return (
    <div class="flex flex-col bg-background fixed inset-0 z-999">
      <Show when={!isDesktop}>
        <div class="flex items-center gap-1 p-4">
          <Icon name="diffusion-logo" class="size-6" />
          <span class="text-sm font-450 text-foreground">Diffusion Studio</span>
        </div>
      </Show>

      <div class="flex flex-1 items-center justify-center pb-16">
        <div class="flex w-124 max-w-[calc(100vw-2rem)] flex-col gap-6">
          <div class="flex flex-col">
            <div class="flex flex-col gap-1 px-2 pt-2 pb-3">
              <h2 class="text-[12px] font-450 text-foreground">Connect your agent</h2>
              <p class="text-xs text-muted-foreground">
                Edit videos with coding agents like Claude Code, Codex, or Cursor.
              </p>
            </div>

            <div class="flex flex-col gap-3 rounded-xl bg-accent/40 p-4">
              <Show
                when={isDesktop}
                fallback={
                  <SetupRow
                    title="Desktop app"
                    description="Ships the MCP server and the dapi CLI that agents control the editor with."
                    action={
                      <StepButton
                        state={mcpState()}
                        label="Get app"
                        doneLabel="Downloaded"
                        onClick={downloadApp}
                      />
                    }
                  />
                }
              >
                <SetupRow
                  title="MCP server"
                  description="Lets agents like Claude Code, Codex, and Cursor control the editor."
                  action={
                    <StepButton
                      state={mcpState()}
                      label="Connect"
                      busyLabel="Connecting…"
                      doneLabel="Connected"
                      onClick={registerMcp}
                    />
                  }
                />

                <div class="h-px w-full bg-border" />

                <SetupRow
                  title="dapi CLI"
                  description="The dapi command in your shell, for scripts and for agents without MCP."
                  action={
                    <StepButton
                      state={cliState()}
                      label="Install"
                      busyLabel="Installing…"
                      doneLabel="Installed"
                      onClick={installCli}
                    />
                  }
                />
              </Show>

            </div>
          </div>

          <div class="flex items-center gap-2 px-2">
            <Button disabled={!allDone()} onClick={() => finish('onboarding_completed')}>
              Get started
            </Button>
            <Button
              variant="ghost"
              class="text-muted-foreground"
              onClick={() => finish('onboarding_skipped')}
            >
              Setup later
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
