/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Copied from https://shadcn-solid.netlify.app/docs/components/sonner

import { useColorMode } from "@kobalte/core"
import { Toaster as Sonner } from "somoto"
import { Icon } from "./icon"

export const Toaster = (props: Parameters<typeof Sonner>[0]) => {
  const { colorMode } = useColorMode()

  return (
    <Sonner
      position="top-center"
      theme={colorMode()}
      
      icons={{
        success: <Icon name="confirm-check" />,
        info: <Icon name="alert-warning" />,
        warning: <Icon name="info" />,
        error: <Icon name="ban" />,
        loading: <Icon name="spinner-loader" class="animate-spin" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: "p-4 w-[350px] gap-2 border border-border rounded-lg bg-background text-foreground",
          title: 'font-450 text-xs',
          description: 'text-xs',
          content: 'flex gap-0.5',
          icon: 'size-6 mb-1',
          actionButton: 'mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer',
          cancelButton: 'mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer',
        },
      }}
      {...props}
    />
  )
}
