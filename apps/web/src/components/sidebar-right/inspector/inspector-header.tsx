/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo } from "solid-js";

import { Icon } from "@/components/ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useWorldState } from "@/components/engine/hooks/use-ecs";
import { useEngine } from "@/context/engine";

export function InspectorHeader() {
  const { world, camera } = useEngine();

  const cameraA = useWorldState(w => w.camera.a, 1);
  const cameraB = useWorldState(w => w.camera.b, 0);

  const zoom = createMemo(() => {
    const scale = Math.hypot(cameraA(), cameraB());
    if (!Number.isFinite(scale)) return null;
    return scale * 100;
  });

  const zoomLabel = () => {
    const value = zoom();
    if (typeof value === "number" && Number.isFinite(value)) {
      return `${Math.round(value)}%`;
    }
    return "72%";
  };

  const getCanvasCenter = () => {
    const canvas = world.canvas;
    if (!(canvas instanceof HTMLCanvasElement)) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: rect.width / 2, y: rect.height / 2 };
  };

  const zoomBy = (factor: number) => {
    const { x, y } = getCanvasCenter();
    camera.zoom(x, y, factor);
  };

  const zoomTo = (targetPercent: number) => {
    const currentScale = Math.hypot(world.camera.a, world.camera.b);
    if (!currentScale || !Number.isFinite(currentScale)) return;
    const factor = (targetPercent / 100) / currentScale;
    const { x, y } = getCanvasCenter();
    camera.zoom(x, y, factor);
  };

  return (
    <div class="h-12 shrink-0 flex items-center px-4">
      <span class="text-[12px] font-strong text-foreground">
        Editor
      </span>
      <DropdownMenu placement="bottom-end">
        <DropdownMenuTrigger<typeof Button>
          as={(triggerProps) => (
            <Button
              {...triggerProps}
              variant="link"
              class="ml-auto flex items-center gap-0 text-muted-foreground px-0 relative z-30"
              style="-webkit-app-region: no-drag;"
            >
              <span>{zoomLabel()}</span>
              <Icon name="chevron-down" class="size-6 shrink-0" />
            </Button>
          )}
        />
        <DropdownMenuPortal>
          <DropdownMenuContent class="w-40">
            <DropdownMenuItem onSelect={() => zoomBy(1.25)}>
              Zoom in
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => zoomBy(0.8)}>
              Zoom out
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => zoomTo(50)}>
              Zoom to 50%
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => zoomTo(100)}>
              Zoom to 100%
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => zoomTo(200)}>
              Zoom to 200%
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenu>
    </div>
  );
}
