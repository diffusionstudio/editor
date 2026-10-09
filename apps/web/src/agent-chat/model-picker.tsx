/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// One dropdown for harness and model, two levels deep: Claude Code and
// Codex first, each opening onto its models, fed by the host's probes. A
// harness that is not ready is one disabled row that says why, never hidden,
// so the picker also says what this works with.

import { For, Show } from "solid-js";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuItemDetail,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cx } from "@/lib/cva";

import type { HarnessId, HarnessInfo, ModelRef } from "@diffusionstudio/agent-chat";

import { chatState, ensureConnected, modelLabel, refreshHarnesses } from "./store";

/** The icons `lib/agents.ts` used, by harness. */
export const harnessIcon = (harness: HarnessId | null | undefined): string =>
  harness === "claude" ? "claude-code" : harness === "codex" ? "codex" : "fx";

function unavailableLabel(harness: HarnessInfo): string {
  switch (harness.status) {
    case "not-installed":
      return "Not installed";
    case "signed-out":
      return harness.detail ? `Sign in: ${harness.detail.replace(/^Run /, "run ")}` : "Signed out";
    case "checking":
      return "Checking…";
    default:
      return harness.detail ?? "Unavailable";
  }
}

type ModelPickerProps = {
  value: ModelRef | null;
  onSelect(ref: ModelRef): void;
  class?: string;
};

export function ModelPicker(props: ModelPickerProps) {
  ensureConnected();
  const harnesses = () => chatState.harnesses;

  return (
    <DropdownMenu placement="bottom-end" onOpenChange={(open) => open && refreshHarnesses()}>
      <DropdownMenuTrigger
        as={Button}
        variant="ghost"
        aria-label="Choose the agent and model"
        class={cx("text-muted-foreground hover:bg-muted data-[expanded]:bg-muted", props.class)}
      >
        <span class="max-w-40 truncate">{modelLabel(props.value)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent class="w-48">
          <DropdownMenuGroup>
            <Show when={harnesses().length === 0}>
              <DropdownMenuItem disabled>
                <span class="min-w-0 flex-1 truncate text-muted-foreground">
                  {chatState.connection === "unavailable" ? "Chat runs in the desktop app" : "Connecting…"}
                </span>
              </DropdownMenuItem>
            </Show>
            <For each={harnesses()}>
              {(harness) => (
                <Show
                  when={harness.status === "ready"}
                  fallback={
                    <DropdownMenuItem disabled>
                      <Icon name={harnessIcon(harness.id)} />
                      <span class="min-w-0 flex-1 truncate">{harness.label}</span>
                      <DropdownMenuItemDetail class="truncate">{unavailableLabel(harness)}</DropdownMenuItemDetail>
                    </DropdownMenuItem>
                  }
                >
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <span class="flex items-center gap-1">
                        <Icon name={harnessIcon(harness.id)} />
                        <span class="min-w-0 truncate">{harness.label}</span>
                      </span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                      <DropdownMenuSubContent class="w-48">
                        <Show when={harness.detail}>
                          {/* "Update Claude Code": the harness works, but is older than we test against. */}
                          <p class="px-2 text-[10px] leading-3.5 text-muted-foreground">{harness.detail}</p>
                        </Show>
                        <DropdownMenuGroup>
                          <For each={harness.models}>
                            {(model) => (
                              <DropdownMenuItem onSelect={() => props.onSelect({ harness: harness.id, model: model.id })}>
                                <span class="min-w-0 flex-1 truncate">{model.label}</span>
                                <Show when={props.value?.harness === harness.id && props.value?.model === model.id}>
                                  <Icon name="confirm-check" />
                                </Show>
                              </DropdownMenuItem>
                            )}
                          </For>
                        </DropdownMenuGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                  </DropdownMenuSub>
                </Show>
              )}
            </For>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}
