/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Copied from https://shadcn-solid.netlify.app/docs/components/badge

import type { ComponentProps, ValidComponent } from "solid-js"
import { splitProps } from "solid-js"
import { Badge as BadgePrimitive } from "@kobalte/core/badge"
import type { VariantProps } from "cva"

import { cva } from "@/lib/cva"
import { tw } from "@/lib/tw"

const invoiceStatusBadgeBase = tw`border-transparent rounded-full px-2 py-[2px] text-xs font-normal`

export const badgeVariants = cva({
  base: tw`inline-flex items-center justify-center border px-1.5 rounded-sm text-xs w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden`,
  variants: {
    variant: {
      base:
        tw`${invoiceStatusBadgeBase} bg-input text-foreground`,
      default:
        tw`border-transparent bg-primary text-background dark:text-foreground [a&]:hover:bg-primary/90`,
      secondary:
        tw`border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90`,
      destructive:
        tw`${invoiceStatusBadgeBase} bg-destructive-accent text-destructive-accent-foreground`,
      success:
        tw`${invoiceStatusBadgeBase} bg-success-accent text-success-accent-foreground`,
      outline:
        tw`text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground`,
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

export type BadgeProps<T extends ValidComponent = "span"> = ComponentProps<
  typeof BadgePrimitive<T>
> &
  VariantProps<typeof badgeVariants>

export const Badge = <T extends ValidComponent = "span">(
  props: BadgeProps<T>,
) => {
  const [, rest] = splitProps(props as BadgeProps, ["class", "variant"])

  return (
    <BadgePrimitive
      data-slot="badge"
      class={badgeVariants({
        variant: props.variant,
        class: props.class,
      })}
      {...rest}
    />
  )
}
