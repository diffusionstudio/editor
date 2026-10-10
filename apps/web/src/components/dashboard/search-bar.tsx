/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { type Accessor, type JSX } from "solid-js";

import { Icon } from "@/components/ui/icon";
import { TextField } from "@/components/ui/text-field";

type DashboardSearchBarProps = {
  value: Accessor<string>;
  onChange: (value: string) => void;
  placeholder: string;
};

type DashboardSearchPanelProps = {
  value: Accessor<string>;
  onChange: (value: string) => void;
  placeholder: string;
  children: JSX.Element;
};

export function DashboardSearchBar(props: DashboardSearchBarProps) {
  return (
    <div class="flex h-12 shrink-0 items-center border-b border-border pl-4 pr-[calc(1rem+var(--titlebar-controls-width))] [[data-platform=win32]_&]:h-10 [[data-platform=win32]_&]:[-webkit-app-region:drag]">
      <TextField class="relative flex h-7 w-full items-center gap-0 [-webkit-app-region:no-drag]">
        <div class="grid size-7 place-items-center overflow-clip text-muted-foreground">
          <Icon name="search" />
        </div>
        <input
          value={props.value()}
          onInput={(event) => props.onChange(event.currentTarget.value)}
          onKeyDown={(event) => event.stopPropagation()}
          onKeyUp={(event) => event.stopPropagation()}
          type="text"
          placeholder={props.placeholder}
          aria-label={props.placeholder}
          class="peer min-w-0 h-7 flex-1 bg-transparent px-0 rounded-none focus-visible:shadow-none focus-within:outline-none py-1 text-base"
        />
        <div
          class="pointer-events-none absolute left-7 top-1/2 h-4 w-px -translate-y-1/2 bg-foreground opacity-0 transition-opacity peer-focus:opacity-100"
          classList={{ hidden: props.value().length > 0 }}
        />
      </TextField>
    </div>
  );
}

export function DashboardSearchPanel(props: DashboardSearchPanelProps) {
  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <DashboardSearchBar
        value={props.value}
        onChange={props.onChange}
        placeholder={props.placeholder}
      />
      {props.children}
    </div>
  );
}
