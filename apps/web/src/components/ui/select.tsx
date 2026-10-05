/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Copied from https://shadcn-solid.netlify.app/docs/components/select

import type { ComponentProps, JSX, ValidComponent, VoidProps } from "solid-js"
import { mergeProps, splitProps } from "solid-js"
import { Select as SelectPrimitive } from "@kobalte/core/select"

import { Icon } from "@/components/ui/icon"
import { cx } from "@/lib/cva"

export const SelectPortal = SelectPrimitive.Portal
export const HiddenSelect = SelectPrimitive.HiddenSelect

export type SelectProps<
  Option,
  OptGroup = never,
  T extends ValidComponent = "div",
> = ComponentProps<typeof SelectPrimitive<Option, OptGroup, T>>

export const Select = <
  Option,
  OptGroup = never,
  T extends ValidComponent = "div",
>(
  props: SelectProps<Option, OptGroup, T>,
) => {
  const [, rest] = splitProps(props as SelectProps<Option, OptGroup>, ["class"])

  return (
    <SelectPrimitive
      data-slot="select"
      class={cx("space-y-2", props.class)}
      {...rest}
    />
  )
}

export type SelectValueProps<
  Options,
  T extends ValidComponent = "span",
> = ComponentProps<typeof SelectPrimitive.Value<Options, T>>

export const SelectValue = <Options, T extends ValidComponent = "span">(
  props: SelectValueProps<Options, T>,
) => {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

export type SelectTriggerProps<T extends ValidComponent = "button"> =
  ComponentProps<typeof SelectPrimitive.Trigger<T>> & {
    size?: "sm" | "default"
  }

export const SelectTrigger = <T extends ValidComponent = "button">(
  props: SelectTriggerProps<T>,
) => {
  const merge = mergeProps({ size: "default" } as SelectTriggerProps, props)
  const [local, rest] = splitProps(merge, ["class", "size", "children"])

  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={local.size}
      class={cx(
        "bg-input hover:bg-input/80 text-foreground data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground flex w-full items-center gap-0 rounded-md pl-2 pr-0 text-xs whitespace-nowrap transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50",
        "relative overflow-hidden after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:opacity-0 after:ring-1 after:ring-inset after:ring-ring after:z-20",
        "data-[size=default]:h-7 data-[size=sm]:h-6",
        "*:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:flex-1 *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        local.class,
      )}
      {...rest}
    >
      {local.children}
      <SelectPrimitive.Icon<ValidComponent>
        class="w-6 h-full shrink-0 text-muted-foreground"
        as={(props) => {
          const [local, rest] = splitProps(props, ["class"])
          return (
            <div
              {...rest}
              class={cx(
                "w-6 h-full shrink-0 text-muted-foreground flex items-center justify-center overflow-clip",
                local.class,
              )}
            >
              <Icon name="chevron-down" class="size-6" />
            </div>
          )
        }}
      />
    </SelectPrimitive.Trigger>
  )
}

export type SelectIconTriggerProps<
  Option,
> = Omit<SelectTriggerProps, "children"> & {
  icon: JSX.Element
  valueClass?: string
  children?: SelectValueProps<Option>["children"]
}

export const SelectIconTrigger = <Option,>(
  props: SelectIconTriggerProps<Option>,
) => {
  const [local, rest] = splitProps(props, ["class", "icon", "valueClass", "children"])

  return (
    <SelectTrigger
      class={cx(
        "!w-full !px-0 !grid !grid-cols-[24px_minmax(0,1fr)_24px] !items-center !justify-normal !gap-0",
        local.class,
      )}
      {...rest}
    >
      <div
        class="w-6 h-7 flex items-center justify-center shrink-0 overflow-clip text-muted-foreground"
      >
        {local.icon}
      </div>
      <SelectValue<Option> class={cx("min-w-0", local.valueClass)}>
        {local.children}
      </SelectValue>
    </SelectTrigger>
  )
}

export type SelectContentProps<T extends ValidComponent = "div"> = VoidProps<
  ComponentProps<typeof SelectPrimitive.Content<T>>
>

export const SelectContent = <T extends ValidComponent = "div">(
  props: SelectContentProps<T>,
) => {
  const [, rest] = splitProps(props as SelectContentProps, ["class"])

  return (
    <SelectPrimitive.Content
      data-slot="select-content"
      class={cx(
        "bg-popover text-popover-foreground data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 data-[closed]:zoom-out-95 data-[expanded]:zoom-in-95 z-[10000] min-w-[8rem] origin-(--kb-select-content-transform-origin) overflow-x-hidden overflow-y-auto flex flex-col gap-2 rounded-xl border border-border p-2 shadow-[0px_0px_1px_2px_rgba(0,0,0,0.12),0px_4px_12px_8px_rgba(0,0,0,0.12),0px_12px_16px_0px_rgba(0,0,0,0.16)] outline-none max-h-[var(--kb-popper-content-available-height)]",
        "[[data-popper-positioner][style*='--kb-popper-content-transform-origin:_top']>[data-slot=select-content]]:slide-in-from-top-2 [[data-popper-positioner][style*='--kb-popper-content-transform-origin:_bottom']>[data-slot=select-content]]:slide-in-from-bottom-2 [[data-popper-positioner][style*='--kb-popper-content-transform-origin:_left']>[data-slot=select-content]]:slide-in-from-left-2 [[data-popper-positioner][style*='--kb-popper-content-transform-origin:_right']>[data-slot=select-content]]:slide-in-from-right-2",
        props.class,
      )}
      {...rest}
    >
      <SelectPrimitive.Listbox class="outline-none flex flex-col gap-0" />
    </SelectPrimitive.Content>
  )
}

export type SelectItemProps<T extends ValidComponent = "li"> = ComponentProps<
  typeof SelectPrimitive.Item<T>
>

export const SelectItem = <T extends ValidComponent = "li">(
  props: SelectItemProps<T>,
) => {
  const [, rest] = splitProps(props as SelectItemProps, ["class", "children"])

  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      class={cx(
        "group [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center rounded-md bg-popover px-2 py-0 text-xs outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 h-7 min-h-7 w-full data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground data-[highlighted]:[&_svg]:text-primary-foreground",
        props.class,
      )}
      {...rest}
    >
      <span class="size-6 shrink-0 flex items-center justify-center overflow-clip">
        <SelectPrimitive.ItemIndicator>
          <Icon name="confirm-check" class="size-6 text-foreground" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemLabel class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
        {(props as SelectItemProps).children}
      </SelectPrimitive.ItemLabel>
    </SelectPrimitive.Item>
  )
}

export type SelectSectionProps<T extends ValidComponent = "li"> =
  ComponentProps<typeof SelectPrimitive.Section<T>>

export const SelectSection = <T extends ValidComponent = "li">(
  props: SelectSectionProps<T>,
) => {
  const [, rest] = splitProps(props as SelectSectionProps, ["class"])

  return (
    <SelectPrimitive.Section
      data-slot="select-section"
      class={cx("text-muted-foreground px-2 py-1.5 text-xs", props.class)}
      {...rest}
    />
  )
}

export type SelectDescriptionProps<T extends ValidComponent = "div"> =
  ComponentProps<typeof SelectPrimitive.Description<T>>

export const SelectDescription = <T extends ValidComponent = "div">(
  props: SelectDescriptionProps<T>,
) => {
  const [, rest] = splitProps(props as SelectDescriptionProps, ["class"])

  return (
    <SelectPrimitive.Description
      data-slot="select-description"
      class={cx(
        "text-muted-foreground text-sm data-[disabled]:opacity-50",
        props.class,
      )}
      {...rest}
    />
  )
}

export type SelectLabelProps<T extends ValidComponent = "label"> =
  ComponentProps<typeof SelectPrimitive.Label<T>>

export const SelectLabel = <T extends ValidComponent = "label">(
  props: SelectLabelProps<T>,
) => {
  const [, rest] = splitProps(props as SelectLabelProps, ["class"])

  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      class={cx(
        "flex items-center gap-2 text-sm leading-none font-450 select-none data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        props.class,
      )}
      {...rest}
    />
  )
}

export type SelectErrorMessageProps<T extends ValidComponent = "div"> =
  ComponentProps<typeof SelectPrimitive.ErrorMessage<T>>

export const SelectErrorMessage = <T extends ValidComponent = "div">(
  props: SelectErrorMessageProps<T>,
) => {
  const [, rest] = splitProps(props as SelectErrorMessageProps, ["class"])

  return (
    <SelectPrimitive.ErrorMessage
      data-slot="select-errormessage"
      class={cx(
        "text-destructive text-sm data-[disabled]:opacity-50",
        props.class,
      )}
      {...rest}
    />
  )
}
