/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Copied from https://shadcn-solid.netlify.app/docs/components/switch

import { splitProps, type ComponentProps, type ValidComponent } from "solid-js"
import { Switch as SwitchPrimitive } from "@kobalte/core/switch"
import { mergeRefs } from "@kobalte/utils"
import type { VariantProps } from "cva"

import { cva, cx } from "@/lib/cva"

export type SwitchProps<T extends ValidComponent = "div"> = ComponentProps<
  typeof SwitchPrimitive<T>
>

export const Switch = <T extends ValidComponent = "div">(
  props: SwitchProps<T>,
) => {
  const [, rest] = splitProps(props as SwitchProps, ["class"])

  return (
    <SwitchPrimitive
      data-slot="switch"
      class={cx("relative", props.class)}
      {...rest}
    />
  )
}

export const switchControlVariants = cva({
  base: [
    "inline-flex items-center rounded-full border border-transparent transition-all",
    "data-[checked]:bg-primary",
    "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
  ],
  variants: {
    variant: {
      default: "bg-input h-4.5 w-8 shadow-xs",
      compact: "h-3.5 w-6 bg-muted p-[2px] shadow-none",
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

export type SwitchControlProps<T extends ValidComponent = "div"> =
  ComponentProps<typeof SwitchPrimitive.Control<T>> &
  VariantProps<typeof switchControlVariants>

export const SwitchControl = <T extends ValidComponent = "div">(
  props: SwitchControlProps<T>,
) => {
  const [, rest] = splitProps(props as SwitchControlProps, ["class", "variant"])

  return (
    <SwitchPrimitive.Control
      data-slot="switch-control"
      class={switchControlVariants(
        {
          variant: props.variant,
          class: props.class,
        },
      )}
      {...rest}
    />
  )
}

export const switchThumbVariants = cva({
  base: "pointer-events-none rounded-full transition-transform",
  variants: {
    variant: {
      default:
        "size-4 bg-background dark:bg-foreground data-[checked]:translate-x-[calc(100%-2px)] dark:data-[checked]:bg-primary-foreground",
      compact:
        "size-2.5 bg-muted-foreground data-[checked]:bg-primary-foreground data-[checked]:translate-x-full",
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

export type SwitchThumbProps<T extends ValidComponent = "div"> = ComponentProps<
  typeof SwitchPrimitive.Thumb<T>
> &
  VariantProps<typeof switchThumbVariants>

export const SwitchThumb = <T extends ValidComponent = "div">(
  props: SwitchThumbProps<T>,
) => {
  const [, rest] = splitProps(props as SwitchThumbProps, ["class", "variant"])

  return (
    <SwitchPrimitive.Thumb
      data-slot="switch-thumb"
      class={switchThumbVariants(
        {
          variant: props.variant,
          class: props.class,
        },
      )}
      {...rest}
    />
  )
}

export type SwitchInputProps<T extends ValidComponent = "input"> =
  ComponentProps<typeof SwitchPrimitive.Input<T>>

export const SwitchInput = <T extends ValidComponent = "input">(
  props: SwitchInputProps<T>,
) => {
  const [local, rest] = splitProps(props as SwitchInputProps, ["class", "ref"])

  const setRef = (element: HTMLInputElement) => {
    const nativeFocus = element.focus.bind(element)
    element.focus = ((options?: FocusOptions) => {
      nativeFocus({
        ...options,
        preventScroll: options?.preventScroll ?? true,
      })
    }) as typeof element.focus
  }

  return (
    <SwitchPrimitive.Input
      data-slot="switch-input"
      class={cx("peer/switch-input", local.class)}
      ref={mergeRefs(setRef, local.ref)}
      {...rest}
    />
  )
}

export type SwitchLabelProps<T extends ValidComponent = "label"> =
  ComponentProps<typeof SwitchPrimitive.Label<T>>

export const SwitchLabel = <T extends ValidComponent = "label">(
  props: SwitchLabelProps<T>,
) => {
  const [, rest] = splitProps(props as SwitchLabelProps, ["class"])

  return (
    <SwitchPrimitive.Label
      data-slot="switch-label"
      class={cx(
        "text-sm font-450 select-none",
        "data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        "data-[invalid]:text-destructive",
        props.class,
      )}
      {...rest}
    />
  )
}

export type SwitchErrorMessageProps<T extends ValidComponent = "div"> =
  ComponentProps<typeof SwitchPrimitive.ErrorMessage<T>>

export const SwitchErrorMessage = <T extends ValidComponent = "div">(
  props: SwitchErrorMessageProps<T>,
) => {
  const [, rest] = splitProps(props as SwitchErrorMessageProps, ["class"])

  return (
    <SwitchPrimitive.ErrorMessage
      data-slot="switch-error-message"
      class={cx("text-destructive text-sm", props.class)}
      {...rest}
    />
  )
}

export type SwitchDescriptionProps<T extends ValidComponent = "div"> =
  ComponentProps<typeof SwitchPrimitive.Description<T>>

export const SwitchDescription = <T extends ValidComponent = "div">(
  props: SwitchDescriptionProps<T>,
) => {
  const [, rest] = splitProps(props as SwitchDescriptionProps, ["class"])

  return (
    <SwitchPrimitive.Description
      data-slot="switch-description"
      class={cx("text-muted-foreground text-sm", props.class)}
      {...rest}
    />
  )
}
