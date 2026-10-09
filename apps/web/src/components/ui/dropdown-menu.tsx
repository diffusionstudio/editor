/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Copied from https://shadcn-solid.netlify.app/docs/components/dropdown-menu

import type { ComponentProps, ValidComponent } from "solid-js"
import { mergeProps, splitProps } from "solid-js"
import { DropdownMenu as DropdownMenuPrimitive } from "@kobalte/core/dropdown-menu"

import { cx } from "@/lib/cva"
import { Icon } from "@/components/ui/icon"

export const DropdownMenuPortal = DropdownMenuPrimitive.Portal

export type DropdownMenuProps = ComponentProps<typeof DropdownMenuPrimitive>

export const DropdownMenu = (props: DropdownMenuProps) => {
  const merge = mergeProps<DropdownMenuProps[]>(
    {
      gutter: 4,
      modal: false,
    },
    props,
  )

  return <DropdownMenuPrimitive data-slot="dropdown-menu" {...merge} />
}

export type DropdownMenuTriggerProps<T extends ValidComponent = "div"> =
  ComponentProps<typeof DropdownMenuPrimitive.Trigger<T>>

export const DropdownMenuTrigger = <T extends ValidComponent = "div">(
  props: DropdownMenuTriggerProps<T>,
) => {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  )
}

export type DropdownMenuGroupProps<T extends ValidComponent = "div"> =
  ComponentProps<typeof DropdownMenuPrimitive.Group<T>>

export const DropdownMenuGroup = <T extends ValidComponent = "div">(
  props: DropdownMenuGroupProps<T>,
) => {
  const [, rest] = splitProps(props as DropdownMenuGroupProps, ["class"])

  return (
    <DropdownMenuPrimitive.Group
      data-slot="dropdown-menu-group"
      class={cx("flex flex-col gap-0 w-full", props.class)}
      {...rest}
    />
  )
}

export type DropdownMenuSubProps = ComponentProps<
  typeof DropdownMenuPrimitive.Sub
>

export const DropdownMenuSub = (props: DropdownMenuSubProps) => {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />
}

export type DropdownMenuRadioGroupProps<T extends ValidComponent = "div"> =
  ComponentProps<typeof DropdownMenuPrimitive.RadioGroup<T>>

export const DropdownMenuRadioGroup = <T extends ValidComponent = "div">(
  props: DropdownMenuRadioGroupProps<T>,
) => {
  return (
    <DropdownMenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

export type DropdownMenuSubTriggerProps<T extends ValidComponent = "div"> =
  ComponentProps<typeof DropdownMenuPrimitive.SubTrigger<T>> & {
    inset?: boolean
  }

export const DropdownMenuSubTrigger = <T extends ValidComponent = "div">(
  props: DropdownMenuSubTriggerProps<T>,
) => {
  const [, rest] = splitProps(props as DropdownMenuSubTriggerProps, [
    "class",
    "children",
    "inset",
  ])

  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={props.inset}
      class={cx(
        "group data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground data-[expanded]:bg-primary data-[expanded]:text-primary-foreground flex cursor-default items-center gap-1 rounded-md bg-popover pl-2 pr-0 py-0 text-xs outline-hidden select-none data-[inset]:pl-8 data-[highlighted]:[&_svg]:text-primary-foreground data-[expanded]:[&_svg]:text-primary-foreground h-7 w-full",
        props.class,
      )}
      {...rest}
    >
      <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
        {props.children}
      </span>
      <span class="h-7 w-6 shrink-0 flex items-center justify-center text-muted-foreground">
        <Icon name="chevron-right" />
      </span>
    </DropdownMenuPrimitive.SubTrigger>
  )
}

export type DropdownMenuSubContentProps<T extends ValidComponent = "div"> =
  ComponentProps<typeof DropdownMenuPrimitive.SubContent<T>>

export const DropdownMenuSubContent = <T extends ValidComponent = "div">(
  props: DropdownMenuSubContentProps<T>,
) => {
  const [, rest] = splitProps(props as DropdownMenuSubContentProps, ["class"])

  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      class={cx(
        "bg-popover translate-x-2.5 -translate-y-2 text-popover-foreground data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 data-[closed]:zoom-out-95 data-[expanded]:zoom-in-95 z-[10000] min-w-[8rem] origin-(--kb-menu-content-transform-origin) overflow-x-hidden overflow-y-auto flex flex-col gap-2 rounded-xl border border-border p-2 shadow-[0px_0px_1px_2px_rgba(0,0,0,0.12),0px_4px_12px_8px_rgba(0,0,0,0.12),0px_12px_16px_0px_rgba(0,0,0,0.16)] outline-none max-h-[var(--kb-popper-content-available-height)]",
        "[[data-popper-positioner][style*='--kb-popper-content-transform-origin:_top']>[data-slot=dropdown-menu-sub-content]]:slide-in-from-top-2 [[data-popper-positioner][style*='--kb-popper-content-transform-origin:_bottom']>[data-slot=dropdown-menu-sub-content]]:slide-in-from-bottom-2 [[data-popper-positioner][style*='--kb-popper-content-transform-origin:_left']>[data-slot=dropdown-menu-sub-content]]:slide-in-from-left-2 [[data-popper-positioner][style*='--kb-popper-content-transform-origin:_right']>[data-slot=dropdown-menu-sub-content]]:slide-in-from-right-2",
        props.class,
      )}
      {...rest}
    />
  )
}

export type DropdownMenuContentProps<T extends ValidComponent = "div"> =
  ComponentProps<typeof DropdownMenuPrimitive.Content<T>>

export const DropdownMenuContent = <T extends ValidComponent = "div">(
  props: DropdownMenuContentProps<T>,
) => {
  const [, rest] = splitProps(props as DropdownMenuContentProps, ["class"])

  return (
    <DropdownMenuPrimitive.Content
      data-slot="dropdown-menu-content"
      class={cx(
        "bg-popover text-popover-foreground data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 data-[closed]:zoom-out-95 data-[expanded]:zoom-in-95 z-[10000] min-w-[8rem] origin-(--kb-menu-content-transform-origin) overflow-x-hidden overflow-y-auto flex flex-col gap-2 rounded-xl border border-border p-2 shadow-[0px_0px_1px_2px_rgba(0,0,0,0.12),0px_4px_12px_8px_rgba(0,0,0,0.12),0px_12px_16px_0px_rgba(0,0,0,0.16)] outline-none max-h-[var(--kb-popper-content-available-height)]",
        "[[data-popper-positioner][style*='--kb-popper-content-transform-origin:_top']>[data-slot=dropdown-menu-content]]:slide-in-from-top-2 [[data-popper-positioner][style*='--kb-popper-content-transform-origin:_bottom']>[data-slot=dropdown-menu-content]]:slide-in-from-bottom-2 [[data-popper-positioner][style*='--kb-popper-content-transform-origin:_left']>[data-slot=dropdown-menu-content]]:slide-in-from-left-2 [[data-popper-positioner][style*='--kb-popper-content-transform-origin:_right']>[data-slot=dropdown-menu-content]]:slide-in-from-right-2",
        props.class,
      )}
      {...rest}
    />
  )
}

export type DropdownMenuItemProps<T extends ValidComponent = "div"> =
  ComponentProps<typeof DropdownMenuPrimitive.Item<T>> & {
    inset?: boolean
    tone?: "primary" | "neutral"
    variant?: "default" | "destructive"
  }

export const DropdownMenuItem = <T extends ValidComponent = "div">(
  props: DropdownMenuItemProps<T>,
) => {
  const [, rest] = splitProps(props as DropdownMenuItemProps, [
    "class",
    "inset",
    "tone",
    "variant",
  ])

  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={props.inset}
      data-variant={props.variant}
      class={cx(
        "group [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-1 rounded-md bg-popover px-2 py-0 text-xs outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 h-7 min-h-7 w-full",
        props.tone === "neutral"
          ? "data-[highlighted]:bg-input data-[highlighted]:text-foreground data-[highlighted]:[&_svg]:text-foreground"
          : "data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground data-[highlighted]:[&_svg]:text-primary-foreground",
        "data-[variant=destructive]:text-destructive data-[variant=destructive]:data-[highlighted]:bg-destructive/10 dark:data-[variant=destructive]:data-[highlighted]:bg-destructive/20 data-[variant=destructive]:data-[highlighted]:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive",
        props.class,
      )}
      {...rest}
    />
  )
}

export type DropdownMenuCheckboxItemProps<T extends ValidComponent = "div"> =
  ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem<T>>

export const DropdownMenuCheckboxItem = <T extends ValidComponent = "div">(
  props: DropdownMenuCheckboxItemProps<T>,
) => {
  const [, rest] = splitProps(props as DropdownMenuCheckboxItemProps, [
    "class",
    "children",
  ])

  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      class={cx(
        "h-7 group data-highlighted:bg-primary data-highlighted:text-foreground relative flex cursor-default items-center gap-0 rounded-sm py-1.5 pr-2 pl-7 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-6",
        props.class,
      )}
      {...rest}
    >
      <span class="pointer-events-none absolute left-0 flex size-6 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Icon name="confirm-check" class="text-foreground" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {props.children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

export type DropdownMenuRadioItemProps<T extends ValidComponent = "div"> =
  ComponentProps<typeof DropdownMenuPrimitive.RadioItem<T>>

export const DropdownMenuRadioItem = <T extends ValidComponent = "div">(
  props: DropdownMenuRadioItemProps<T>,
) => {
  const [, rest] = splitProps(props as DropdownMenuRadioItemProps, [
    "class",
    "children",
  ])

  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      class={cx(
        "group data-[highlighted]:bg-primary relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        props.class,
      )}
      {...rest}
    >
      <span class="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator
          as="svg"
          xmlns="http://www.w3.org/2000/svg"
          class="size-1"
          viewBox="0 0 24 24"
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            fill="currentColor"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
          />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {props.children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

export type DropdownMenuGroupLabelProps<T extends ValidComponent = "span"> =
  ComponentProps<typeof DropdownMenuPrimitive.GroupLabel<T>> & {
    inset?: boolean
  }

export const DropdownMenuGroupLabel = <T extends ValidComponent = "span">(
  props: DropdownMenuGroupLabelProps<T>,
) => {
  const [, rest] = splitProps(props as DropdownMenuGroupLabelProps, [
    "class",
    "inset",
  ])

  return (
    <DropdownMenuPrimitive.GroupLabel
      as="div"
      data-slot="dropdown-menu-group-label"
      data-inset={props.inset}
      class={cx(
        "text-muted-foreground my-1.5 px-2 text-xs font-normal data-[inset]:pl-8",
        props.class,
      )}
      {...rest}
    />
  )
}

export type DropdownMenuItemLabelProps<T extends ValidComponent = "div"> =
  ComponentProps<typeof DropdownMenuPrimitive.ItemLabel<T>> & {
    inset?: boolean
  }

export const DropdownMenuItemLabel = <T extends ValidComponent = "div">(
  props: DropdownMenuItemLabelProps<T>,
) => {
  const [, rest] = splitProps(props as DropdownMenuItemLabelProps, [
    "class",
    "inset",
  ])

  return (
    <DropdownMenuPrimitive.ItemLabel
      data-slot="dropdown-menu-item-label"
      data-inset={props.inset}
      class={cx(
        "text-foreground px-2 py-1.5 text-sm font-450 data-[inset]:pl-8",
        props.class,
      )}
      {...rest}
    />
  )
}

export type DropdownMenuSeparatorProps<T extends ValidComponent = "hr"> =
  ComponentProps<typeof DropdownMenuPrimitive.Separator<T>>

export const DropdownMenuSeparator = <T extends ValidComponent = "hr">(
  props: DropdownMenuSeparatorProps<T>,
) => {
  const [, rest] = splitProps(props as DropdownMenuSeparatorProps, ["class"])

  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      class={cx("bg-border h-px w-full", props.class)}
      {...rest}
    />
  )
}

export type DropdownMenuShortcutProps = ComponentProps<"span">

export const DropdownMenuShortcut = (props: DropdownMenuShortcutProps) => {
  const [, rest] = splitProps(props, ["class"])

  return (
    <span
      data-slot="dropdown-menu-shortcut"
      class={cx(
        "text-muted-foreground ml-auto text-xs tracking-widest group-[[data-highlighted]]:text-[inherit] group-[[data-expanded]]:text-[inherit]",
        props.class,
      )}
      {...rest}
    />
  )
}

export type DropdownMenuItemDetailProps = ComponentProps<"span">

export const DropdownMenuItemDetail = (props: DropdownMenuItemDetailProps) => {
  const [, rest] = splitProps(props, ["class"])

  return (
    <span
      data-slot="dropdown-menu-item-detail"
      class={cx(
        "min-w-5 text-right text-xxs text-muted-foreground group-[[data-highlighted]]:text-[inherit] group-[[data-expanded]]:text-[inherit]",
        props.class,
      )}
      {...rest}
    />
  )
}
