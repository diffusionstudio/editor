/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The prompt box, docked at the bottom of the panel in every state. Looks
// like the dashboard composer, sized to the chat sidebar, and never moves:
// no centred start, no animated height, a static placeholder.

import { For, Show, createEffect } from "solid-js";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

import type { ModelRef } from "@diffusionstudio/agent-chat";

import { AttachmentTile, DropOverlay, createDropZone, createPasteHandler, mergeAttachments, pickAttachments, type Attachment } from "./attachments";
import { ModelPicker } from "./model-picker";

const MAX_HEIGHT_PX = 160;

type ComposerProps = {
  text: string;
  attachments: Attachment[];
  onText(text: string): void;
  onAttachments(attachments: Attachment[]): void;
  /** Whether a turn runs or waits: the send button becomes Stop. */
  running: boolean;
  /** A question is pending: sending is disabled, Stop still works. */
  waiting: boolean;
  /** Why nothing can be sent, or null. Shown as the placeholder while the box is disabled. */
  blocked: string | null;
  model: ModelRef | null;
  onModel(ref: ModelRef): void;
  onSend(): void;
  onStop(): void;
};

export function Composer(props: ComposerProps) {
  let textarea: HTMLTextAreaElement | undefined;

  const attach = (added: Attachment[]) => props.onAttachments(mergeAttachments(props.attachments, added));
  const drop = createDropZone(attach);
  const paste = createPasteHandler(attach);

  const canSend = () => !props.running && !props.blocked && props.model !== null && (props.text.trim().length > 0 || props.attachments.length > 0);

  // Grows with its content, instantly, up to the cap; then it scrolls.
  const resize = () => {
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_HEIGHT_PX)}px`;
  };
  createEffect(() => {
    void props.text;
    resize();
  });

  // Enter sends, shift+enter breaks the line — and the editor's shortcuts
  // have no business reading what is typed here. While a turn runs Enter
  // does nothing: there is no queue.
  const handleKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (canSend()) props.onSend();
  };

  const sendTitle = () => (props.waiting ? "Waiting for your answer" : props.blocked ?? "Send");

  return (
    <div
      class="relative mx-4 mb-4 flex shrink-0 flex-col gap-2 rounded-xl border border-border bg-accent p-2 focus-within:border-border-input"
      onDragOver={drop.onDragOver}
      onDragEnter={drop.onDragEnter}
      onDragLeave={drop.onDragLeave}
      onDrop={drop.onDrop}
      onPaste={paste}
    >
      <Show when={props.attachments.length > 0}>
        {/* The remove buttons overhang the tiles' corners, and a scrolling
            row clips at its edge — so the row pads for them and pulls itself
            back up by the same amount. */}
        <div class="-mt-2.5 flex w-full items-start gap-1.5 overflow-x-auto pt-2.5 pr-2.5">
          <For each={props.attachments}>
            {(entry) => (
              <AttachmentTile
                attachment={entry}
                class="size-9 [&>div]:rounded-md"
                onRemove={() => props.onAttachments(props.attachments.filter((item) => item.key !== entry.key))}
              />
            )}
          </For>
        </div>
      </Show>

      <textarea
        ref={textarea}
        value={props.text}
        onInput={(event) => props.onText(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        onKeyUp={(event) => event.stopPropagation()}
        aria-label="Message the agent"
        placeholder={props.blocked ?? "Do anything"}
        disabled={props.blocked !== null}
        rows={1}
        class="max-h-40 min-h-7 w-full resize-none overflow-auto bg-transparent p-1 text-[12px] leading-5 text-foreground outline-none placeholder:text-muted-foreground selection:bg-selection selection:text-selection-foreground disabled:cursor-default"
      />

      <div class="flex min-h-4 items-center justify-between gap-1">
        <Button
          variant="ghost"
          size="icon-square"
          onClick={async () => attach(await pickAttachments())}
          aria-label="Add files"
          title="Add files"
          class="text-muted-foreground hover:bg-muted"
        >
          <Icon name="plus-add" />
        </Button>
        <div class="flex min-w-0 items-center gap-1.5">
          <ModelPicker value={props.model} onSelect={props.onModel} class="min-w-0" />
          <Show
            when={props.running}
            fallback={
              <button
                type="button"
                onClick={() => canSend() && props.onSend()}
                disabled={!canSend()}
                aria-label="Send"
                title={sendTitle()}
                class="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-40 focus-ring"
              >
                <Icon name="arrow-top" />
              </button>
            }
          >
            <button
              type="button"
              onClick={props.onStop}
              aria-label="Stop"
              title="Stop"
              class="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground hover:bg-primary-hover focus-ring"
            >
              <Icon name="stop" />
            </button>
          </Show>
        </div>
      </div>

      <Show when={drop.dragging()}>
        <DropOverlay radius="rounded-xl" />
      </Show>
    </div>
  );
}
