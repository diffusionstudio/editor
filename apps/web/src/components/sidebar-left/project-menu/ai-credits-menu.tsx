/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useNavigate } from "@solidjs/router";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/context/auth";

function formatCredits(value: number): string {
  return value.toLocaleString();
}

function progressWidth(used: number, total: number): string {
  if (total <= 0) return "0%";
  const percent = Math.min(100, Math.max(0, (used / total) * 100));
  return `${percent}%`;
}

export function AiCreditsMenu() {
  const auth = useAuth();
  const navigate = useNavigate();

  const isSubscribed = () => auth.isSubscribed();
  const total = () => auth.creditLimit();
  const remaining = () => auth.remainingCredits();
  const used = () => Math.max(0, total() - remaining());

  const usageLabel = () => `${formatCredits(used())} / ${formatCredits(total())}`;

  const footerLabel = () => {
    if (!isSubscribed()) return "One time only";
    const reset = auth.nextCreditReset();
    if (!reset) return "Resets monthly";
    const days = Math.max(0, Math.ceil((reset.getTime() - Date.now()) / 86_400_000));
    return `Resets in ${days} ${days === 1 ? "day" : "days"}`;
  };

  const openAiCredits = () => {
    (document.activeElement as HTMLElement)?.blur?.();
    navigate("/?dashboard=billing");
  };

  return (
    <>
      <DropdownMenuGroup>
        <div class="h-7 flex items-center px-2 text-xs text-muted-foreground">
          <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
            Usage
          </span>
          <span class="shrink-0 text-right">{usageLabel()}</span>
        </div>
        <div class="h-7 flex items-center px-2">
          <div class="w-full h-3 rounded-full bg-border overflow-hidden">
            <div
              class="h-full rounded-full bg-primary"
              style={{ width: progressWidth(used(), total()) }}
            />
          </div>
        </div>
        <div class="h-7 flex items-center px-2 text-xs text-muted-foreground">
          {footerLabel()}
        </div>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuItem onSelect={openAiCredits}>Buy credits</DropdownMenuItem>
    </>
  );
}
