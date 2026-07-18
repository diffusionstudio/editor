/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { mergeProps, splitProps } from "solid-js";

import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  type TooltipContentProps,
  type TooltipProps,
} from "@/components/ui/tooltip";

export type IconButtonProps = ButtonProps<"button"> & {
  /** Tooltip content: the control's name in the shortest natural UI language. */
  tooltip: string;
  /** Accessible name, deliberately decoupled from the tooltip: describe what activating the control does ("Change blend mode"). */
  "aria-label": string;
  shortcut?: TooltipContentProps["shortcut"];
  placement?: TooltipProps["placement"];
};

export const IconButton = (props: IconButtonProps) => {
  const merge = mergeProps(
    { size: "icon", variant: "ghost" } satisfies ButtonProps,
    props,
  );
  const [local, rest] = splitProps(merge, [
    "tooltip",
    "shortcut",
    "placement",
    "children",
  ]);

  return (
    <Tooltip placement={local.placement}>
      <TooltipTrigger as={Button} {...rest}>
        {local.children}
      </TooltipTrigger>
      <TooltipContent shortcut={local.shortcut}>{local.tooltip}</TooltipContent>
    </Tooltip>
  );
};
