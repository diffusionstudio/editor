/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Copied from https://shadcn-solid.netlify.app/docs/components/button

import type { ComponentProps, ValidComponent } from "solid-js"
import { splitProps } from "solid-js"
import { Root as ButtonPrimitive } from "@kobalte/core/button"
import type { VariantProps } from "cva"

import { cva } from "@/lib/cva"
import { tw } from "@/lib/tw"

export const buttonVariants = cva({
  base: [
    tw`inline-flex items-center justify-center gap-0 whitespace-nowrap rounded-md font-450 text-xs transition-all shrink-0 outline-none`,
    tw`disabled:pointer-events-none disabled:opacity-50`,
    tw`[&_svg]:pointer-events-none [&_svg]:shrink-0`,
    tw`aria-[invalid]:ring-destructive/20 aria-[invalid]:dark:ring-destructive/40 aria-[invalid]:border-destructive`,
  ],

  variants: {
    variant: {
      default: tw`bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-pressing data-[expanded]:bg-primary-hover`,
      secondary: tw`bg-secondary text-foreground hover:bg-secondary-hover active:bg-secondary-pressing data-[expanded]:bg-secondary-hover`,
      on: tw`bg-tertiary text-tertiary-foreground hover:bg-tertiary-hover active:bg-tertiary-pressing data-[expanded]:bg-tertiary-hover`,
      ghost: tw`hover:bg-accent active:bg-muted data-[expanded]:bg-accent`,
      link: tw`px-0 bg-transparent text-muted-foreground hover:text-foreground active:text-foreground data-[expanded]:text-foreground`,
      destructive:
        tw`bg-destructive text-destructive-foreground hover:bg-destructive-hover active:bg-destructive-pressing data-[expanded]:bg-destructive-hover`,
      outline: tw`bg-transparent border border-border-input text-foreground hover:bg-input`,
    },
    size: {
      default: tw`h-7 px-2`,
      small: tw`h-5 px-1 text-xxs font-normal rounded`,
      icon: tw`w-6 h-7 p-0`,
      "icon-square": tw`w-7 h-7 p-0`,
      "icon-select": tw`w-4 h-7 p-0`,
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
})

export type ButtonProps<T extends ValidComponent = "button"> = ComponentProps<
  typeof ButtonPrimitive<T>
> &
  VariantProps<typeof buttonVariants>

export const Button = <T extends ValidComponent = "button">(
  props: ButtonProps<T>,
) => {
  const [, rest] = splitProps(props as ButtonProps, [
    "class",
    "variant",
    "size",
  ])

  return (
    <ButtonPrimitive
      data-slot="button"
      class={buttonVariants({
        variant: props.variant,
        size: props.size,
        class: props.class,
      })}
      {...rest}
    />
  )
}
