/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// One dropdown for harness and model, fed by the host's probes. A harness that
// is not ready is one disabled row that says why, never hidden, so the picker
// also says what this works with.

import { For, Show, createMemo } from "solid-js";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";

import type { HarnessId, HarnessInfo, ModelRef } from "@diffusionstudio/agent-chat";

import { chatState, ensureConnected, modelLabel, refreshHarnesses } from "./store";

/** The icons `lib/agents.ts` used, by harness. */
export const harnessIcon = (harness: HarnessId | null | undefined): string =>
  harness === "claude" ? "claude-code" : harness === "codex" ? "codex" : harness === "opencode" ? "opencode" : "fx";

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

type HarnessModel = HarnessInfo["models"][number];

/**
 * One harness's models, grouped by `model.group` into a submenu each, so a
 * harness with a hundred models is a few rows instead of a hundred. Models
 * without a group list flat.
 */
function HarnessModels(props: { harness: HarnessInfo; value: ModelRef | null; onSelect(ref: ModelRef): void }) {
  const grouped = createMemo(() => {
    const byGroup = new Map<string, HarnessModel[]>();
    const flat: HarnessModel[] = [];
    for (const model of props.harness.models) {
      if (!model.group) {
        flat.push(model);
        continue;
      }
      const models = byGroup.get(model.group);
      if (models) models.push(model);
      else byGroup.set(model.group, [model]);
    }
    return { flat, groups: [...byGroup] };
  });

  const row = (model: HarnessModel) => (
    <DropdownMenuItem onSelect={() => props.onSelect({ harness: props.harness.id, model: model.id })}>
      <Icon name={harnessIcon(props.harness.id)} />
      <span class="min-w-0 flex-1 truncate">{model.label}</span>
      <Show when={props.value?.harness === props.harness.id && props.value?.model === model.id}>
        <Icon name="confirm-check" class="size-6" />
      </Show>
    </DropdownMenuItem>
  );

  return (
    <>
      <For each={grouped().flat}>{(model) => row(model)}</For>
      <For each={grouped().groups}>
        {([group, models]) => (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{group}</DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent class="max-h-96! w-56">
                <For each={models}>{(model) => row(model)}</For>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        )}
      </For>
    </>
  );
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
    <DropdownMenu placement="bottom-start" onOpenChange={(open) => open && refreshHarnesses()}>
      <DropdownMenuTrigger
        as="button"
        type="button"
        aria-label="Choose the agent and model"
        class={`flex h-7 shrink-0 items-center rounded-md pl-0.5 pr-2 text-xs font-450 text-muted-foreground hover:bg-muted focus-ring ${props.class ?? ""}`}
      >
        <span class="grid size-6 shrink-0 place-items-center overflow-clip">
          <Icon name={harnessIcon(props.value?.harness)} />
        </span>
        <span class="max-w-40 truncate">{modelLabel(props.value)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent class="w-56">
          <Show when={harnesses().length === 0}>
            <DropdownMenuGroup>
              <DropdownMenuItem disabled>
                <span class="min-w-0 flex-1 truncate text-muted-foreground">
                  {chatState.connection === "unavailable" ? "Chat runs in the desktop app" : "Connecting…"}
                </span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </Show>
          <For each={harnesses()}>
            {(harness, index) => (
              <>
                <Show when={index() > 0}>
                  <DropdownMenuSeparator />
                </Show>
                <DropdownMenuGroup>
                  <DropdownMenuGroupLabel>{harness.label}</DropdownMenuGroupLabel>
                  <Show when={harness.status === "ready" && harness.detail}>
                    {/* "Update Claude Code": the harness works, but is older than we test against. */}
                    <p class="px-2 pb-1 text-[10px] leading-3.5 text-muted-foreground">{harness.detail}</p>
                  </Show>
                  <Show
                    when={harness.status === "ready"}
                    fallback={
                      <DropdownMenuItem disabled>
                        <Icon name={harnessIcon(harness.id)} />
                        <span class="min-w-0 flex-1 truncate text-muted-foreground">{unavailableLabel(harness)}</span>
                      </DropdownMenuItem>
                    }
                  >
                    <HarnessModels harness={harness} value={props.value} onSelect={props.onSelect} />
                  </Show>
                </DropdownMenuGroup>
              </>
            )}
          </For>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}
