/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { JSX } from "solid-js";
import { mergeProps, splitProps } from "solid-js";

import { Button, type ButtonProps } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  type DropdownMenuProps,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
  type TooltipContentProps,
  type TooltipProps,
} from "@/components/ui/tooltip";

export type MenuIconButtonProps = ButtonProps<"button"> & {
  /** Tooltip content: the control's name in the shortest natural UI language. */
  tooltip: string;
  /** Accessible name, deliberately decoupled from the tooltip: describe what activating the control does ("Open timeline options"). */
  "aria-label": string;
  shortcut?: TooltipContentProps["shortcut"];
  tooltipPlacement?: TooltipProps["placement"];
  placement?: DropdownMenuProps["placement"];
  modal?: DropdownMenuProps["modal"];
  preventScroll?: DropdownMenuProps["preventScroll"];
  onOpenChange?: DropdownMenuProps["onOpenChange"];
  /** Button content (usually an `<Icon />`). */
  icon: JSX.Element;
  contentClass?: string;
  /** Menu items. */
  children: JSX.Element;
};

/** Tooltip + menu trigger collapsed onto one `<button>`; tooltip/menu coordination lives in the ui/tooltip.tsx focus gate. */
export const MenuIconButton = (props: MenuIconButtonProps) => {
  const merge = mergeProps(
    { size: "icon", variant: "ghost" } satisfies ButtonProps,
    props,
  );
  const [local, rest] = splitProps(merge, [
    "tooltip",
    "shortcut",
    "tooltipPlacement",
    "placement",
    "modal",
    "preventScroll",
    "onOpenChange",
    "icon",
    "contentClass",
    "children",
  ]);

  return (
    <DropdownMenu
      placement={local.placement}
      modal={local.modal}
      preventScroll={local.preventScroll}
      onOpenChange={local.onOpenChange}
    >
      <Tooltip placement={local.tooltipPlacement}>
        <TooltipTrigger<typeof DropdownMenuTrigger>
          as={(triggerProps: object) => (
            <DropdownMenuTrigger<typeof Button>
              {...triggerProps}
              as={(buttonProps) => (
                <Button {...buttonProps} {...rest}>
                  {local.icon}
                </Button>
              )}
            />
          )}
        />
        {/* Portaled so overflow containers can't clip the tooltip. */}
        <TooltipPortal>
          <TooltipContent shortcut={local.shortcut}>{local.tooltip}</TooltipContent>
        </TooltipPortal>
      </Tooltip>
      <DropdownMenuPortal>
        <DropdownMenuContent class={local.contentClass}>
          {local.children}
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
};
