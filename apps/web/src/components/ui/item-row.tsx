/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { JSX } from 'solid-js';
import { Show, splitProps } from 'solid-js';
import { cx } from '@/lib/cva';
import { callHandler } from '@/lib/call-handler';

export type ItemRowProps = JSX.HTMLAttributes<HTMLDivElement> & {
    value: string;
    label?: string;
    icon?: JSX.Element;
    disabled?: boolean;
    children?: JSX.Element;
};

/**
 * Reusable row component for settings panels.
 * Pattern: [Label 64px] + [Icon Wrapper 24x28] + [Text (flex-1)] + [Action 24x28]
 */
export function ItemRow(props: ItemRowProps) {
    const [local, others] = splitProps(props, [
        "value",
        "label",
        "icon",
        "class",
        "disabled",
        "onClick",
        "children",
    ]);

    const handleClick: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent> = (e) => {
        if (local.disabled) return;
        if (e.target instanceof Element && e.target.closest('button')) return;
        callHandler(e, local.onClick);
    };

    return (
        <div
            class={cx("flex items-center gap-2", local.class)}
            classList={{ "opacity-50": local.disabled }}
            {...others}
        >
            <Show when={local.label}>
                <span class="w-16 shrink-0 text-xs text-muted-foreground truncate">
                    {local.label}
                </span>
            </Show>
            <div
                data-row-control=""
                class="bg-input flex-1 min-w-0 h-7 rounded-md p-1 pr-0 flex items-center gap-2 hover:bg-input/80 transition-colors relative cursor-default overflow-clip"
                onClick={handleClick}
            >
                <Show when={local.icon}>
                    <div class="text-foreground size-5 rounded-sm flex items-center justify-center bg-primary overflow-clip">
                        {local.icon}
                    </div>
                </Show>

                <span class="flex-1 min-w-0 text-xs text-foreground truncate">
                    {local.value}
                </span>

                {local.children}
            </div>
        </div>
    );
}
