/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Icon } from "@/components/ui/icon";

import type { Item } from "@diffusionstudio/agent-chat";

import "./activity.css";

/** What the agent is doing, judged by the item the turn is on. A tool in flight has its own row, so it never lands here. */
export function runningLabel(last: Item | undefined): string {
  return last?.kind === "assistant" ? "Writing" : "Thinking";
}

export function RunningIndicator(props: { last: Item | undefined }) {
  return (
    <div class="flex h-6 items-center text-[11px] text-muted-foreground" role="status" aria-live="polite">
      <Icon name="spinner-loader" class="shrink-0 animate-spin" />
      <span class="agent-ellipsis">{runningLabel(props.last)}</span>
    </div>
  );
}
