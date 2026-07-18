/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  Show,
  mergeProps,
  onCleanup,
  onMount,
  splitProps,
  useContext,
  type Accessor,
  type Component,
  type ComponentProps,
  type JSX,
} from "solid-js"
import { Dialog as DialogPrimitive } from "@kobalte/core/dialog"

import { cx } from "@/lib/cva"
import { clamp } from "@/utils"
import { Separator } from "./separator"

type MaybeAccessor<T> = T | Accessor<T>

type FloatingInspectorContextValue = {
  registerDragHandle: (el: HTMLElement | null) => void
}

type FloatingInspectorTopContextValue = {
  top: Accessor<number>
}

const FloatingInspectorContext = createContext<FloatingInspectorContextValue>()
const FloatingInspectorTopContext = createContext<FloatingInspectorTopContextValue>()

const DRAG_HANDLE_SELECTOR = "[data-slot='floating-inspector-header']"
const NON_DRAG_INTERACTIVE_SELECTOR = [
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "[role='button']",
  "[data-no-drag='true']",
].join(",")
const VIEWPORT_PADDING = 8
const DEFAULT_OFFSET = 8
const DEFAULT_WIDTH = 264

const toValue = <T,>(value: MaybeAccessor<T>): T => {
  return typeof value === "function" ? (value as Accessor<T>)() : value
}

const blurActiveEditable = () => {
  const active = document.activeElement
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    active.blur()
  }
}

const getAvailableTop = (preferredTop: number, inspectorHeight: number): number => {
  const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - inspectorHeight - VIEWPORT_PADDING)
  return clamp(preferredTop, VIEWPORT_PADDING, maxTop)
}

export type FloatingInspectorProps = ComponentProps<"div"> & {
  anchorRef: MaybeAccessor<HTMLElement | null | undefined>
  width?: number
  offset?: MaybeAccessor<number>
  open?: MaybeAccessor<boolean>
}

export const FloatingInspector = (props: FloatingInspectorProps) => {
  const merge = mergeProps(
    {
      open: true,
      offset: DEFAULT_OFFSET,
      width: DEFAULT_WIDTH,
    },
    props,
  )

  const [local, rest] = splitProps(merge, [
    "class",
    "anchorRef",
    "width",
    "offset",
    "open",
    "children",
  ])

  const parentTopContext = useContext(FloatingInspectorTopContext)

  let rootRef: HTMLDivElement | undefined
  let dragHandleRef: HTMLElement | null = null

  const [position, setPosition] = createSignal({ left: VIEWPORT_PADDING, top: VIEWPORT_PADDING })
  const [isDragging, setIsDragging] = createSignal(false)
  const [isPositionInitialized, setIsPositionInitialized] = createSignal(false)

  let dragOffsetX = 0
  let dragOffsetY = 0
  let activePointerId: number | null = null

  const width = createMemo(() => Math.max(0, Number(local.width) || DEFAULT_WIDTH))
  const offset = createMemo(() => Math.max(0, Number(toValue(local.offset)) || DEFAULT_OFFSET))
  const isOpen = createMemo(() => Boolean(toValue(local.open)))

  const updateInitialPosition = () => {
    if (isPositionInitialized()) return

    const anchor = toValue(local.anchorRef)
    const root = rootRef
    if (!anchor || !root) return

    const anchorRect = anchor.getBoundingClientRect()
    const inspectorRect = root.getBoundingClientRect()

    const preferredTop = parentTopContext?.top() ?? anchorRect.top
    const top = getAvailableTop(preferredTop, inspectorRect.height)

    const preferredLeft = anchorRect.left - width() - offset()
    const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - width() - VIEWPORT_PADDING)
    const left = clamp(preferredLeft, VIEWPORT_PADDING, maxLeft)

    setPosition({ left, top })
    setIsPositionInitialized(true)
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!isDragging()) return
    if (activePointerId !== null && event.pointerId !== activePointerId) return

    const root = rootRef
    if (!root) return

    const rect = root.getBoundingClientRect()
    const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - rect.width - VIEWPORT_PADDING)
    const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - rect.height - VIEWPORT_PADDING)

    const left = clamp(event.clientX - dragOffsetX, VIEWPORT_PADDING, maxLeft)
    const top = clamp(event.clientY - dragOffsetY, VIEWPORT_PADDING, maxTop)

    setPosition({ left, top })
  }

  const cleanupDrag = () => {
    window.removeEventListener("pointermove", onPointerMove)
    window.removeEventListener("pointerup", onPointerUp)
    window.removeEventListener("pointercancel", onPointerUp)
    setIsDragging(false)
    activePointerId = null
  }

  const onPointerUp = (event: PointerEvent) => {
    if (activePointerId !== null && event.pointerId !== activePointerId) return
    cleanupDrag()
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (target?.closest(NON_DRAG_INTERACTIVE_SELECTOR)) return

    blurActiveEditable()

    const root = rootRef
    if (!root) return

    const rect = root.getBoundingClientRect()

    dragOffsetX = event.clientX - rect.left
    dragOffsetY = event.clientY - rect.top

    activePointerId = event.pointerId
    setIsDragging(true)

    dragHandleRef?.setPointerCapture?.(event.pointerId)

    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", onPointerUp)
    window.addEventListener("pointercancel", onPointerUp)

    event.preventDefault()
  }

  const setDragHandle = (el: HTMLElement | null) => {
    if (dragHandleRef) {
      dragHandleRef.removeEventListener("pointerdown", onPointerDown)
    }

    dragHandleRef = el

    if (dragHandleRef) {
      dragHandleRef.style.cursor = "grab"
      dragHandleRef.addEventListener("pointerdown", onPointerDown)
    }
  }

  createEffect(() => {
    if (!isOpen()) return
    toValue(local.anchorRef)
    width()
    offset()
    setIsPositionInitialized(false)
    queueMicrotask(updateInitialPosition)
  })

  onMount(() => {
    blurActiveEditable()

    queueMicrotask(() => {
      updateInitialPosition()
      if (!dragHandleRef && rootRef) {
        const fallbackHandle = rootRef.querySelector<HTMLElement>(DRAG_HANDLE_SELECTOR)
        setDragHandle(fallbackHandle)
      }
    })

    const onResize = () => {
      const root = rootRef
      if (!root) return

      setPosition((current) => {
        const rect = root.getBoundingClientRect()
        const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - rect.width - VIEWPORT_PADDING)
        const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - rect.height - VIEWPORT_PADDING)

        return {
          left: clamp(current.left, VIEWPORT_PADDING, maxLeft),
          top: clamp(current.top, VIEWPORT_PADDING, maxTop),
        }
      })
    }

    window.addEventListener("resize", onResize)

    onCleanup(() => {
      window.removeEventListener("resize", onResize)
      cleanupDrag()
      setDragHandle(null)
    })
  })

  const contextValue: FloatingInspectorContextValue = {
    registerDragHandle: setDragHandle,
  }

  return (
    <Show when={isOpen()}>
      <FloatingInspectorTopContext.Provider value={{ top: () => position().top }}>
        <FloatingInspectorContext.Provider value={contextValue}>
          <div
            ref={rootRef}
            data-slot="floating-inspector"
            class={cx(
              "bg-background border-border fixed z-50 w-[264px] overflow-hidden rounded-xl border",
              "shadow-[0_12px_24px_rgba(0,0,0,0.24)]",
              local.class,
            )}
            style={{
              left: `${position().left}px`,
              top: `${position().top}px`,
              width: `${width()}px`,
            }}
            {...rest}
          >
            {local.children}
          </div>
        </FloatingInspectorContext.Provider>
      </FloatingInspectorTopContext.Provider>
    </Show>
  )
}

export type FloatingInspectorLayerProps = {
  open?: boolean
  onDismiss: () => void
  modal?: boolean
  triggerRef?: HTMLElement
  triggerControlSelector?: string
  labelledBy?: string
  children?: JSX.Element
}

export const FloatingInspectorLayer: Component<FloatingInspectorLayerProps> = (
  props,
) => {
  return (
    <DialogPrimitive
      open={props.open ?? true}
      modal={props.modal ?? false}
      preventScroll={false}
      onOpenChange={(isOpen) => {
        if (!isOpen) props.onDismiss()
      }}
    >
      <DialogPrimitive.Content
        aria-labelledby={props.labelledBy}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          const target = event.target as Element | null
          if (!target || !props.triggerRef?.contains(target)) return
          if (props.triggerControlSelector && !target.closest(props.triggerControlSelector)) return
          event.preventDefault()
        }}
      >
        {props.children}
      </DialogPrimitive.Content>
    </DialogPrimitive>
  )
}

export type FloatingInspectorHeaderProps = ComponentProps<"div">

export const FloatingInspectorHeader: Component<FloatingInspectorHeaderProps> = (
  props,
) => {
  const context = useContext(FloatingInspectorContext)
  const [local, rest] = splitProps(props, ["class", "ref"])

  const mergedRef = (el: HTMLDivElement) => {
    context?.registerDragHandle(el)

    const ref = local.ref
    if (typeof ref === "function") {
      ref(el)
      return
    }

    if (ref && typeof ref === "object") {
      ; (ref as { current?: HTMLElement | null }).current = el
    }
  }

  return (
    <div
      ref={mergedRef}
      data-slot="floating-inspector-header"
      class={cx("flex h-11 items-center p-2 pl-[15px] text-base", local.class)}
      {...rest}
    />
  )
}

export type FloatingInspectorContentProps = ComponentProps<"div">

export const FloatingInspectorContent: Component<FloatingInspectorContentProps> = (
  props,
) => {
  const [local, rest] = splitProps(props, ["class"])

  return (
    <div
      data-slot="floating-inspector-content"
      class={cx("p-2", local.class)}
      {...rest}
    />
  )
}

export type FloatingInspectorTitleProps = ComponentProps<"span">

export const FloatingInspectorTitle: Component<FloatingInspectorTitleProps> = (
  props,
) => {
  const [local, rest] = splitProps(props, ["class"])

  return (
    <span
      data-slot="floating-inspector-title"
      class={cx("text-foreground", local.class)}
      {...rest}
    />
  )
}

export type FloatingInspectorSeparatorProps = ComponentProps<"div">

export const FloatingInspectorSeparator: Component<FloatingInspectorSeparatorProps> = (
  props,
) => {
  const [local, rest] = splitProps(props, ["class"])

  return (
    <div class={cx("mx-2", local.class)} {...rest}>
      <Separator />
    </div>
  )
}
