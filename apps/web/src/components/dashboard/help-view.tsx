/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show } from "solid-js";
import { toast } from "somoto";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useAuth } from "@/context/auth";

import {
  DashboardLabelValue,
  DashboardDividedStack,
  DashboardScrollView,
  DashboardSurfaceSection,
} from "./shared";

type DashboardHelpExternalRowProps = {
  label: string;
  href: string;
};

function DashboardHelpExternalRow(props: DashboardHelpExternalRowProps) {
  return (
    <div class="flex h-4 w-full items-center gap-4 rounded-md text-xs text-foreground outline-none focus-ring">
      <span class="min-w-0 flex-1 truncate text-left">
        {props.label}
      </span>
      <a href={props.href} target="_blank">
        <Icon name="external-link" class="text-foreground" />
      </a>
    </div>
  );
}

type DashboardHelpUserIdRowProps = {
  value: string;
  onCopy: () => void;
};

function DashboardHelpUserIdRow(props: DashboardHelpUserIdRowProps) {
  return (
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center">
      <DashboardLabelValue
        label="User id"
        value={props.value}
        valueClass="truncate text-xxs"
      />
      <Button variant="secondary" onClick={props.onCopy}>
        Copy
      </Button>
    </div>
  );
}

export function DashboardHelpView() {
  const auth = useAuth();
  const userId = () => auth.user()?.id ?? "";

  const copyUserId = async () => {
    const id = userId();
    if (!id) return;

    try {
      await navigator.clipboard.writeText(id);
      toast("Copied!", { description: "The user id has been copied to your clipboard." });
    } catch (error) {
      toast("Failed to copy", { description: error instanceof Error ? error.message : "Unknown error" });
    }
  };

  return (
    <DashboardScrollView>
      <DashboardSurfaceSection title="Resources">
        <DashboardDividedStack>
          <DashboardHelpExternalRow
            label="What's new"
            href="https://www.diffusion.studio/updates"
          />
          <DashboardHelpExternalRow
            label="Discord community"
            href="https://discord.gg/AYySWDhgNK"
          />
        </DashboardDividedStack>
      </DashboardSurfaceSection>

      <DashboardSurfaceSection title="Support">
        <DashboardDividedStack>
          <Show when={userId()}>
            <DashboardHelpUserIdRow value={userId()} onCopy={copyUserId} />
          </Show>
          <DashboardHelpExternalRow
            label="Report issue"
            href="mailto:support@diffusion.studio"
          />
          <DashboardHelpExternalRow
            label="Contact support"
            href="https://discord.gg/AYySWDhgNK"
          />
        </DashboardDividedStack>
      </DashboardSurfaceSection>

      {/* 
      <DashboardSurfaceSection title="Keyboard shortcuts">
        <DashboardInfoActionRow
          leading={<Icon name="keyboard-shortcut" class="text-foreground" />}
          title="View, search, and customize shortcuts."
          action={
            <Button variant="secondary">
              Open keyboard shortcuts...
            </Button>
          }
          layout="inline"
        />
      </DashboardSurfaceSection> 
      */}
    </DashboardScrollView>
  );
}

