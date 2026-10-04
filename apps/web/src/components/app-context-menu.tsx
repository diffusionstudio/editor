/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createSignal } from "solid-js"
import type { JSX } from "solid-js"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { takeContextMenuItems } from "@/components/context-menu-extras"
import type { ContextMenuExtra } from "@/components/context-menu-extras"

export function AppContextMenu(props: { children: JSX.Element }) {
  const [extras, setExtras] = createSignal<ContextMenuExtra[]>([])
  let keepFocus = false

  const handleUndo = () => {
    document.execCommand("undo")
  }

  const handleRedo = () => {
    document.execCommand("redo")
  }

  const handleCut = () => {
    document.execCommand("cut")
  }

  const handleCopy = () => {
    document.execCommand("copy")
  }

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      document.execCommand("insertText", false, text)
    } catch {
      document.execCommand("paste")
    }
  }

  const handleSelectAll = () => {
    document.execCommand("selectAll")
  }

  const handleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void document.documentElement.requestFullscreen()
    }
  }

  const handleReload = () => {
    window.location.reload()
  }


  return (
    <ContextMenu>
      <ContextMenuTrigger class="contents" onContextMenu={(event: MouseEvent) => setExtras(takeContextMenuItems(event))}>
        {props.children}
      </ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent
          class="w-[200px]"
          onCloseAutoFocus={(event: Event) => {
            if (keepFocus) event.preventDefault()
            keepFocus = false
          }}
        >
          <Show when={extras().length > 0}>
            <For each={extras()}>
              {(item) => (
                <ContextMenuItem
                  onSelect={() => {
                    keepFocus = true
                    item.onSelect()
                  }}
                >
                  {item.label}
                  <Show when={item.shortcut}>
                    <ContextMenuShortcut>{item.shortcut}</ContextMenuShortcut>
                  </Show>
                </ContextMenuItem>
              )}
            </For>
            <ContextMenuSeparator />
          </Show>
          <ContextMenuItem onSelect={handleUndo}>
            Undo
            <ContextMenuShortcut>⌘Z</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleRedo}>
            Redo
            <ContextMenuShortcut>⇧⌘Z</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleCut}>
            Cut
            <ContextMenuShortcut>⌘X</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleCopy}>
            Copy
            <ContextMenuShortcut>⌘C</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={handlePaste}>
            Paste
            <ContextMenuShortcut>⌘V</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleSelectAll}>
            Select All
            <ContextMenuShortcut>⌘A</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleFullscreen}>
            {document.fullscreenElement ? "Exit Fullscreen" : "Fullscreen"}
            <ContextMenuShortcut>F11</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleReload}>
            Reload
            <ContextMenuShortcut>⌘R</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenu>
  )
}
