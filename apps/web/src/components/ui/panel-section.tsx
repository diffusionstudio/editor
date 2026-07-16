/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { JSX } from "solid-js";
import { Show, splitProps } from "solid-js";
import { cx } from "@/lib/cva";

type PanelSectionProps = {
  title: string | JSX.Element;
  subtitle?: JSX.Element;
  actions?: JSX.Element;
  children?: JSX.Element;
  class?: string;
  ref?: HTMLDivElement;
};

export function PanelSection(props: PanelSectionProps) {
  const [local] = splitProps(props, [
    "title",
    "subtitle",
    "actions",
    "children",
    "ref",
    "class",
  ]);

  return (
    <>
      <div class="flex items-center justify-between h-10 border-t border-border px-4 text-muted-foreground [&:has(+_*>_*)]:text-foreground" ref={local.ref}>
        <div class="flex items-center gap-1 text-xs font-450">
          <Show
            when={typeof local.title === "string"}
            fallback={local.title}
          >
            {local.title}
          </Show>
          {local.subtitle}
        </div>
        <Show when={local.actions != null}>
          <div class="flex items-center gap-1">{local.actions}</div>
        </Show>
      </div>

      <div
        class={cx(
          "[&:has(>*)]:pb-3 gap-2 w-full max-w-full min-w-0 px-4 flex flex-col data-[grid=true]:grid *:min-w-0 grid-cols-[1fr_1fr]",
          local.class
        )}
      >
        {local.children}
      </div>
    </>
  );
}
