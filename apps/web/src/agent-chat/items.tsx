/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// One component per item kind. Small enough to live together: what they
// share is the 12 px body text and the muted 11 px chrome.

import { For, Show, createSignal } from "solid-js";

import { Icon } from "@/components/ui/icon";

import type { Item } from "@diffusionstudio/agent-chat";

import { AttachmentChip } from "./attachments";
import { Markdown } from "./markdown";
import "./activity.css";

type Of<K extends Item["kind"]> = Extract<Item, { kind: K }>;

export function UserItem(props: { item: Of<"user"> }) {
  return (
    <div class="flex flex-col gap-1">
      <Show when={props.item.attachments?.length}>
        <div class="flex flex-col items-end gap-1">
          <For each={props.item.attachments}>{(path) => <AttachmentChip path={path} />}</For>
        </div>
      </Show>
      <Show when={props.item.text.trim()}>
        <div class="whitespace-pre-wrap break-words rounded-md bg-muted px-2 py-1.5 text-[12px] leading-5 text-foreground">
          {props.item.text}
        </div>
      </Show>
    </div>
  );
}

export function AssistantItem(props: { item: Of<"assistant"> }) {
  return (
    <div class="px-0.5">
      <Markdown text={props.item.text} />
    </div>
  );
}

/** The record of a thought: what the model is on right now is the transcript's running indicator, not this row. */
export function ReasoningItem(props: { item: Of<"reasoning"> }) {
  const [open, setOpen] = createSignal(false);
  const expandable = () => props.item.text.trim().length > 0;
  return (
    <div class="pr-0.5">
      <button
        type="button"
        class="flex h-6 items-center text-[11px] text-muted-foreground focus-ring rounded-sm"
        classList={{ "hover:text-foreground": expandable(), "cursor-default": !expandable() }}
        aria-expanded={open()}
        onClick={() => expandable() && setOpen(!open())}
      >
        <Icon name={open() ? "chevron-down" : "chevron-right"} />
        <span>Thinking</span>
      </button>
      <Show when={open()}>
        <div class="mt-0.5 whitespace-pre-wrap break-words border-l border-border pl-2 text-[11px] leading-4 text-muted-foreground">
          {props.item.text}
        </div>
      </Show>
    </div>
  );
}

export function ToolItem(props: { item: Of<"tool"> }) {
  const [open, setOpen] = createSignal(false);
  const expandable = () => !!(props.item.detail || props.item.output || props.item.images?.length);
  return (
    <div class="pr-0.5">
      <button
        type="button"
        class="flex h-6 w-full min-w-0 items-center text-left text-[11px] text-muted-foreground focus-ring rounded-sm"
        classList={{ "hover:text-foreground": expandable(), "cursor-default": !expandable() }}
        aria-expanded={open()}
        onClick={() => expandable() && setOpen(!open())}
      >
        <Show when={props.item.status === "running"}>
          <Icon name="spinner-loader" class="shrink-0 animate-spin" />
        </Show>
        <Show when={props.item.status === "done"}>
          <Icon name="confirm-check" class="shrink-0" />
        </Show>
        <Show when={props.item.status === "failed"}>
          <Icon name="close-remove-small" class="shrink-0 text-destructive" />
        </Show>
        <span class="shrink-0 font-450" classList={{ "agent-shimmer": props.item.status === "running" }}>
          {props.item.title}
        </span>
        <Show when={props.item.detail}>
          <span class="shrink-0">·</span>
          <span class="min-w-0 truncate" classList={{ "agent-shimmer": props.item.status === "running" }}>
            {props.item.detail}
          </span>
        </Show>
      </button>
      <Show when={open()}>
        <div class="mt-0.5 flex flex-col gap-1 border-l border-border pl-2">
          <Show when={props.item.detail}>
            <pre class="overflow-x-auto whitespace-pre-wrap break-words text-[11px] leading-4 text-muted-foreground">{props.item.detail}</pre>
          </Show>
          <Show when={props.item.output}>
            <pre class="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-input p-1.5 text-[11px] leading-4 text-foreground">
              {props.item.output}
            </pre>
          </Show>
          <For each={props.item.images}>
            {(image) => (
              <img
                src={`data:${image.mediaType};base64,${image.data}`}
                alt={`${props.item.title} result`}
                class="max-h-60 max-w-full self-start rounded-md border border-border object-contain"
                loading="lazy"
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

/** The compact record of what was asked and answered: "Format → 9:16", or "Skipped". */
export function QuestionItem(props: { item: Of<"question"> }) {
  return (
    <div class="flex flex-col gap-0.5 px-0.5 text-[11px] text-muted-foreground">
      <For each={props.item.questions}>
        {(question) => (
          <div class="flex min-w-0 items-center gap-1">
            <span class="shrink-0 rounded bg-input px-1 py-px text-[10px] font-450">{question.header || "Question"}</span>
            <span class="shrink-0">→</span>
            <span class="min-w-0 truncate text-foreground" title={question.question}>
              {props.item.answers === null ? "Skipped" : props.item.answers[question.id]?.join(", ") || "Skipped"}
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

export function NoticeItem(props: { item: Of<"notice"> }) {
  return (
    <div
      class="px-0.5 text-[11px] leading-4 break-words"
      classList={{ "text-muted-foreground": props.item.level === "info", "text-destructive": props.item.level === "error" }}
    >
      {props.item.text}
    </div>
  );
}

/** Dispatches on kind. */
export function ChatItem(props: { item: Item }) {
  const item = () => props.item;
  return (
    <>
      <Show when={item().kind === "user"}>
        <UserItem item={item() as Of<"user">} />
      </Show>
      <Show when={item().kind === "assistant"}>
        <AssistantItem item={item() as Of<"assistant">} />
      </Show>
      {/* Thinking the model keeps to itself arrives as an empty block: nothing to show. */}
      <Show when={item().kind === "reasoning" && (item() as Of<"reasoning">).text.trim()}>
        <ReasoningItem item={item() as Of<"reasoning">} />
      </Show>
      <Show when={item().kind === "tool"}>
        <ToolItem item={item() as Of<"tool">} />
      </Show>
      <Show when={item().kind === "question"}>
        <QuestionItem item={item() as Of<"question">} />
      </Show>
      <Show when={item().kind === "notice"}>
        <NoticeItem item={item() as Of<"notice">} />
      </Show>
    </>
  );
}
