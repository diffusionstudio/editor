/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Accessor } from "solid-js"
import { createMemo, createSignal } from "solid-js"
import { Listbox } from "@kobalte/core/listbox"
import { Popover as PopoverPrimitive } from "@kobalte/core/popover"

import { Popover, PopoverPortal, PopoverTrigger } from "@/components/ui/popover"
import { Icon } from "@/components/ui/icon"
import { cx } from "@/lib/cva"

export type CenteredSelectMenuOption<Value extends string> = {
  value: Value
  label: string
  disabled?: boolean
}

export type CenteredSelectMenuProps<Value extends string> = {
  value: Accessor<Value>
  onChange: (nextValue: Value) => void
  options: readonly CenteredSelectMenuOption<Value>[]
  "aria-label": string
  triggerClass?: string
  contentClass?: string
  maxVisibleItems?: number
}

export const CenteredSelectMenu = <Value extends string>(
  props: CenteredSelectMenuProps<Value>,
) => {
  const [open, setOpen] = createSignal(false)

  const selectedOption = createMemo(() => {
    const value = props.value()
    return props.options.find((option) => option.value === value)
  })

  const selectedIndex = createMemo(() => {
    const value = props.value()
    const index = props.options.findIndex((option) => option.value === value)
    return Math.max(0, index)
  })

  const visibleItems = createMemo(() => {
    const max = Math.max(1, props.maxVisibleItems ?? 7)
    return Math.max(1, Math.min(props.options.length || 1, max))
  })

  const centerIndex = createMemo(() => Math.floor(visibleItems() / 2))

  const menuOptions = createMemo(() => {
    const options = props.options
    if (!options.length) return []

    const startIndex =
      (selectedIndex() - centerIndex() + options.length) % options.length

    return [...options.slice(startIndex), ...options.slice(0, startIndex)]
  })

  const gutter = createMemo(() => -(28 + 8 + centerIndex() * 28))

  return (
    <Popover
      placement="bottom"
      gutter={gutter()}
      open={open()}
      onOpenChange={setOpen}
    >
      <PopoverTrigger
        as="button"
        type="button"
        aria-label={props["aria-label"]}
        class={cx(
          "flex h-7 items-center rounded-md bg-input pl-2 pr-0 text-xs text-foreground outline-none transition-[box-shadow,border-color]",
          "border border-transparent",
          "data-[expanded]:border-ring data-[expanded]:ring-1 data-[expanded]:ring-inset data-[expanded]:ring-ring",
          props.triggerClass,
        )}
      >
        <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap py-[2px]">
          {selectedOption()?.label ?? ""}
        </span>
        <span class="grid h-7 w-6 place-items-center overflow-clip text-muted-foreground">
          <Icon name="chevron-down" />
        </span>
      </PopoverTrigger>

      <PopoverPortal>
        <PopoverPrimitive.Content
          data-slot="centered-select-menu-content"
          class={cx(
            "bg-popover text-popover-foreground data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 data-[closed]:zoom-out-95 data-[expanded]:zoom-in-95 z-[10000] origin-center overflow-hidden flex flex-col gap-0 rounded-xl border border-border p-2 shadow-[0px_0px_1px_2px_rgba(0,0,0,0.12),0px_4px_12px_8px_rgba(0,0,0,0.12),0px_12px_16px_0px_rgba(0,0,0,0.16)] outline-none",
            props.contentClass,
          )}
        >
          <Listbox<CenteredSelectMenuOption<Value>>
            options={menuOptions()}
            optionValue="value"
            optionTextValue="label"
            optionDisabled="disabled"
            value={[props.value()]}
            shouldFocusOnHover
            class="flex w-full flex-col gap-0 overflow-y-auto outline-none"
            style={{ height: `${visibleItems() * 28}px` }}
            onChange={(nextValue: Set<string>) => {
              setOpen(false)

              const selected = nextValue.values().next().value as Value | undefined
              if (!selected) return

              props.onChange(selected)
            }}
            renderItem={(item) => (
              <Listbox.Item
                item={item}
                class={cx(
                  "group relative flex h-7 w-full cursor-default items-center gap-1 rounded-md bg-popover px-0 pr-2 py-0 text-xs outline-none select-none",
                  "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                  "data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground",
                  "data-[selected]:bg-primary data-[selected]:text-primary-foreground",
                  "data-[highlighted]:[&_svg]:text-primary-foreground data-[selected]:[&_svg]:text-primary-foreground",
                )}
              >
                <span class="flex h-7 w-6 shrink-0 items-center justify-center overflow-clip">
                  <Listbox.ItemIndicator>
                    <Icon name="confirm-check" />
                  </Listbox.ItemIndicator>
                </span>
                <span class="min-w-0 flex-1 truncate text-xs">
                  {item.rawValue.label}
                </span>
              </Listbox.Item>
            )}
          />
        </PopoverPrimitive.Content>
      </PopoverPortal>
    </Popover>
  )
}
