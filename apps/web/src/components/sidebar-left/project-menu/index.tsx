/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Icon } from "@/components/ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { useNavigate } from "@solidjs/router";
import { Show, onCleanup, onMount } from "solid-js";
import { isInputTarget } from "@/utils";
import { useEditorApi } from "@/context/dapi";
import { downloadDesktopApp } from "@/lib/desktop-app";
import { FileMenu } from "./file-menu";
import { EditMenu } from "./edit-menu";
import { ViewMenu } from "./view-menu";
import { ToolMenu } from "./tool-menu";
import { AiCreditsMenu } from "./ai-credits-menu";
import { HelpMenu } from "./help-menu";
import { companionUiCapabilities } from "@/lib/companion-capabilities";

export function ProjectMenu() {
  const navigate = useNavigate();
  const { isDesktop } = useEditorApi();
  const capabilities = companionUiCapabilities();

  const handleOpenDashboard = () => {
    (document.activeElement as HTMLElement)?.blur?.();
    navigate("/?dashboard=projects");
  };

  const handleOpenAccount = () => {
    (document.activeElement as HTMLElement)?.blur?.();
    navigate("/?dashboard=account");
  };

  /**
   * Leaving the editor is the app's command rather than the runtime's, so its
   * key is bound here, with the item that offers it.
   */
  const handleShortcut = (event: KeyboardEvent) => {
    if (!capabilities.projectWrite) return;
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
    if (event.key.toLowerCase() !== "d" || isInputTarget(event)) return;

    event.preventDefault();
    handleOpenDashboard();
  };

  onMount(() => {
    window.addEventListener("keydown", handleShortcut);
    onCleanup(() => window.removeEventListener("keydown", handleShortcut));
  });

  return (
    <>
      <DropdownMenu placement="bottom-start">
        <DropdownMenuTrigger
          as="button"
          type="button"
          class="flex items-center gap-0 h-7 rounded-md text-muted-foreground outline-none focus-ring hover:text-foreground data-expanded:text-foreground"
        >
          <Icon name="diffusion-logo" class="size-6" />
          <div class="flex items-center justify-center overflow-clip h-6 w-4">
            <Icon name="chevron-down" class="size-6" />
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent class="w-[196px]">
            <Show when={capabilities.projectWrite}>
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={handleOpenDashboard}>
                  Go to dashboard
                  <DropdownMenuShortcut>⇧⌘D</DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuGroup>

              <DropdownMenuSeparator />
            </Show>

            <DropdownMenuGroup>
              <Show when={capabilities.projectWrite}>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>File</DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent class="w-[196px]">
                      <FileMenu />
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>

                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Edit</DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent class="w-[196px]">
                      <EditMenu />
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              </Show>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>View</DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent class="w-[216px]">
                    <ViewMenu />
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>

              <Show when={capabilities.projectWrite}>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Tool</DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent class="w-[172px]">
                      <ToolMenu />
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              </Show>
            </DropdownMenuGroup>

            <Show when={capabilities.account || capabilities.externalNavigation}>
              <DropdownMenuSeparator />

              <DropdownMenuGroup>
                <Show when={capabilities.ai}>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>AI credits</DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                      <DropdownMenuSubContent class="w-[188px]">
                        <AiCreditsMenu />
                      </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                  </DropdownMenuSub>
                </Show>

                <Show when={capabilities.externalNavigation}>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>Help</DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                      <DropdownMenuSubContent class="w-[188px]">
                        <HelpMenu />
                      </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                  </DropdownMenuSub>
                </Show>

                <Show when={capabilities.account}>
                  <DropdownMenuItem onSelect={handleOpenAccount}>Account</DropdownMenuItem>
                </Show>
              </DropdownMenuGroup>
            </Show>

            <Show when={!isDesktop && capabilities.desktopPromotion}>
              <DropdownMenuSeparator />

              <DropdownMenuGroup>
                <DropdownMenuItem
                  class="gap-1 pl-0 pr-2"
                  onSelect={() => downloadDesktopApp("main_menu")}
                >
                  <span class="grid h-7 w-6 shrink-0 place-items-center overflow-clip">
                    <Icon name="download" class="size-6" />
                  </span>
                  Get desktop app (macOS)
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </Show>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenu>
    </>
  );
}
