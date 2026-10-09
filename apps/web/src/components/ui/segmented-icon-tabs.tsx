/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Match, Switch, type Accessor, type JSX } from "solid-js";

import { cx } from "@/lib/cva";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type SegmentedIconTab<T extends string = string> = {
  value: T;
  label: string;
  icon?: string | JSX.Element;
  iconClass?: string;
  disabled?: boolean;
};

export type SegmentedIconTabsProps<T extends string = string> = {
  value: Accessor<T>;
  onChange?: (value: T) => void;
  items: readonly SegmentedIconTab<T>[] | Accessor<readonly SegmentedIconTab<T>[]>;
  class?: string;
  buttonClass?: string;
  iconClass?: string;
  disabled?: boolean;
};

export function SegmentedIconTabs<T extends string = string>(
  props: SegmentedIconTabsProps<T>,
) {
  const items = () =>
    typeof props.items === "function" ? props.items() : props.items;

  return (
    <div class={cx("flex gap-px items-center overflow-clip rounded-md", props.class)}>
      <For each={items()}>
        {(item) => {
          const isActive = () => props.value() === item.value;
          const isDisabled = () =>
            props.disabled || item.disabled;

          return (
            <Tooltip openDelay={600} disabled={!item.icon}>
              <TooltipTrigger
                as="button"
                type="button"
                class={cx(
                  "flex-1 h-7 flex items-center justify-center",
                  props.buttonClass,
                  isActive()
                    ? "bg-inset text-foreground"
                    : "bg-input text-muted-foreground",
                )}
                disabled={isDisabled()}
                onClick={() => props.onChange?.(item.value)}
                aria-label={item.label}
              >
                <Switch>
                  <Match when={!item.icon}>
                    <span class="text-xs font-450">{item.label}</span>
                  </Match>
                  <Match when={typeof item.icon === "string"}>
                    <Icon name={item.icon as string} class={cx("size-6", props.iconClass)} />
                  </Match>
                  <Match when={typeof item.icon === "object" && item.icon != null}>
                    {item.icon}
                  </Match>
                </Switch>
              </TooltipTrigger>
              <TooltipContent>{item.label}</TooltipContent>
            </Tooltip>
          );
        }}
      </For>
    </div>
  );
}
