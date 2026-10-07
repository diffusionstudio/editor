/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Copied from https://shadcn-solid.netlify.app/docs/components/slider

import type { VoidProps } from "solid-js"
import { splitProps, type ComponentProps, type ValidComponent } from "solid-js"
import { Slider as SliderPrimitive } from "@kobalte/core/slider"

import { cx } from "@/lib/cva"

export type SliderProps<T extends ValidComponent = "div"> = ComponentProps<
  typeof SliderPrimitive<T>
>

export const Slider = <T extends ValidComponent = "div">(
  props: SliderProps<T>,
) => {
  const [, rest] = splitProps(props as SliderProps, ["class"])

  return (
    <SliderPrimitive
      data-slot="slider"
      class={cx(
        "relative flex w-full touch-none flex-col items-center gap-2 select-none data-disabled:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto",
        props.class,
      )}
      {...rest}
    />
  )
}

export type SliderTrackProps<T extends ValidComponent = "div"> = ComponentProps<
  typeof SliderPrimitive.Track<T>
>

export const SliderTrack = <T extends ValidComponent = "div">(
  props: SliderTrackProps<T>,
) => {
  const [, rest] = splitProps(props as SliderTrackProps, ["class"])

  return (
    <SliderPrimitive.Track
      data-slot="slider-track"
      class={cx(
        "bg-muted relative rounded-full data-[orientation=horizontal]:h-1 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-[inherit] data-[orientation=vertical]:min-h-[inherit] data-[orientation=vertical]:w-1",
        props.class,
      )}
      {...rest}
    />
  )
}

export type SliderFillProps<T extends ValidComponent = "div"> = VoidProps<
  ComponentProps<typeof SliderPrimitive.Fill<T>>
>

export const SliderFill = <T extends ValidComponent = "div">(
  props: SliderFillProps<T>,
) => {
  const [, rest] = splitProps(props as SliderFillProps, ["class"])

  return (
    <SliderPrimitive.Fill
      data-slot="slider-fill"
      class={cx(
        "bg-primary absolute rounded-full data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full",
        props.class,
      )}
      {...rest}
    />
  )
}

export type SliderThumbProps<T extends ValidComponent = "span"> = VoidProps<
  ComponentProps<typeof SliderPrimitive.Thumb<T>>
>

export const SliderThumb = <T extends ValidComponent = "span">(
  props: SliderThumbProps<T>,
) => {
  const [, rest] = splitProps(props as SliderThumbProps, ["class"])

  return (
    <SliderPrimitive.Thumb
      data-slot="slider-thumb"
      class={cx(
        "border border-background bg-foreground ring-foreground/20 size-3 rounded-full shadow-sm transition-[color,box-shadow] hover:ring-3 hover:border-none focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50 data-[orientation=horizontal]:-top-1 data-[orientation=vertical]:-left-1",
        props.class,
      )}
      {...rest}
    >
      <SliderPrimitive.Input />
    </SliderPrimitive.Thumb>
  )
}

export type SliderGroupProps = ComponentProps<"div">

export const SliderGroup = (props: SliderGroupProps) => {
  const [, rest] = splitProps(props, ["class"])

  return (
    <div
      data-slot="slider-group"
      class={cx("flex w-full justify-between", props.class)}
      {...rest}
    />
  )
}

export type SliderLabelProps<T extends ValidComponent = "label"> =
  ComponentProps<typeof SliderPrimitive.Label<T>>

export const SliderLabel = <T extends ValidComponent = "label">(
  props: SliderLabelProps<T>,
) => {
  const [, rest] = splitProps(props as SliderLabelProps, ["class"])

  return (
    <SliderPrimitive.Label
      data-slot="slider-label"
      class={cx("text-sm font-450 select-none", props.class)}
      {...rest}
    />
  )
}

export type SliderValueLabelProps<T extends ValidComponent = "div"> =
  ComponentProps<typeof SliderPrimitive.ValueLabel<T>>

export const SliderValueLabel = <T extends ValidComponent = "div">(
  props: SliderValueLabelProps<T>,
) => {
  const [, rest] = splitProps(props as SliderValueLabelProps, ["class"])

  return (
    <SliderPrimitive.ValueLabel
      data-slot="slider-value-label"
      class={cx("text-sm font-450 select-none", props.class)}
      {...rest}
    />
  )
}

export type SliderDescriptionProps<T extends ValidComponent = "div"> =
  ComponentProps<typeof SliderPrimitive.Description<T>>

export const SliderDescription = <T extends ValidComponent = "div">(
  props: SliderDescriptionProps<T>,
) => {
  const [, rest] = splitProps(props as SliderDescriptionProps, ["class"])

  return (
    <SliderPrimitive.Description
      data-slot="slider-description"
      class={cx("text-muted-foreground text-sm", props.class)}
      {...rest}
    />
  )
}

export type SliderErrorMessageProps<T extends ValidComponent = "div"> =
  ComponentProps<typeof SliderPrimitive.ErrorMessage<T>>

export const SliderErrorMessage = <T extends ValidComponent = "div">(
  props: SliderErrorMessageProps<T>,
) => {
  const [, rest] = splitProps(props as SliderErrorMessageProps, ["class"])

  return (
    <SliderPrimitive.ErrorMessage
      data-slot="slider-ErrorMessage"
      class={cx("text-destructive text-sm", props.class)}
      {...rest}
    />
  )
}
