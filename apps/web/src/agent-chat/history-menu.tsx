/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// This project's chats, newest first: title, relative time, a spinner while
// one runs, a dot and "Needs you" while one waits, a check on the active one.
// Hovering a row shows a remove button that deletes without confirmation.

import { For, Show } from "solid-js";
import { toast } from "somoto";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";

import type { ChatSummary } from "@diffusionstudio/agent-chat";

import { chatState, deleteChat, refreshChats } from "./store";

type HistoryMenuProps = {
  projectId: string;
  chatId: string | null;
  onOpen(chatId: string): void;
};

/** "just now", "5m", "3h", "2d", else a short date. */
export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function HistoryMenu(props: HistoryMenuProps) {
  const chats = () => chatState.lists[props.projectId] ?? [];

  const remove = (event: MouseEvent, chat: ChatSummary) => {
    event.stopPropagation();
    event.preventDefault();
    deleteChat(props.projectId, chat.id).catch((error: Error) => toast.error("Could not delete the chat", { description: error.message }));
  };

  return (
    <DropdownMenu placement="bottom-end" onOpenChange={(open) => open && void refreshChats(props.projectId)}>
      <DropdownMenuTrigger<typeof Button>
        as={(triggerProps) => (
          <Button {...triggerProps} variant="ghost" size="icon" class="text-muted-foreground" aria-label="Chat history" title="Chat history">
            <Icon name="history" />
          </Button>
        )}
      />
      <DropdownMenuPortal>
        <DropdownMenuContent class="w-72">
          <DropdownMenuGroup>
            <Show
              when={chats().length > 0}
              fallback={
                <DropdownMenuItem disabled>
                  <span class="min-w-0 flex-1 truncate text-muted-foreground">No chats yet</span>
                </DropdownMenuItem>
              }
            >
              <For each={chats()}>
                {(chat) => (
                  <DropdownMenuItem tone="neutral" class="group/row" onSelect={() => props.onOpen(chat.id)}>
                    <Show when={chat.status === "running"}>
                      <Icon name="spinner-loader" class="animate-spin -mr-1 shrink-0" />
                    </Show>
                    <Show when={chat.status === "waiting"}>
                      <Icon name="dot" class="-mr-1 shrink-0 text-primary" />
                    </Show>
                    <span class="min-w-0 flex-1 truncate" title={chat.title}>
                      {chat.title}
                    </span>
                    <Show when={chat.id !== props.chatId}>
                      <span class="shrink-0 text-[10px] text-muted-foreground group-hover/row:hidden">
                        {chat.status === "waiting" ? "Needs you" : relativeTime(chat.updatedAt)}
                      </span>
                    </Show>
                    <Show when={chat.id === props.chatId}>
                      <Icon name="confirm-check" class="-mr-1 shrink-0 group-hover/row:hidden" />
                    </Show>
                    <button
                      type="button"
                      aria-label={`Delete chat ${chat.title}`}
                      class="relative hidden size-6 shrink-0 -mr-1 text-muted-foreground transition-colors hover:text-foreground focus-ring group-hover/row:inline-block"
                      onPointerDown={(event) => event.stopPropagation()}
                      onPointerUp={(event) => event.stopPropagation()}
                      onClick={(event) => remove(event, chat)}
                    >
                      <Icon
                        name="close-remove-small"
                        class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-inherit!"
                      />
                    </button>
                  </DropdownMenuItem>
                )}
              </For>
            </Show>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}
