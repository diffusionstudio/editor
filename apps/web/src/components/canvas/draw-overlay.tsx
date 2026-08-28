/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show } from "solid-js";
import { useWorld } from "@diffusionstudio/koota-solid";
import { Rect, Scene, SolidPaint, Text } from "@diffusionstudio/reconciler";
import {
  Computed,
  findSceneAt,
  getNextName,
  Root,
  screenToWorld,
  Source,
  store,
  Tool,
  ToolType,
  worldToLocal,
} from "@diffusionstudio/runtime";
import { useEditor, useTool } from "@/engine";

import type { Entity } from "@diffusionstudio/koota";
import type { Point } from "@diffusionstudio/runtime";

type ToolConfig = {
  isScene?: boolean;
  fillColor: string;
  previewColor: string;
  namePrefix: string;
  label: string;
  defaultWidth: number;
  defaultHeight: number;
};

const TOOL_CONFIG: Partial<Record<ToolType, ToolConfig>> = {
  [ToolType.RECT]: {
    fillColor: '#E0E0E0',
    previewColor: '#E0E0E0',
    namePrefix: 'Rect',
    label: 'Create shape',
    defaultWidth: 300,
    defaultHeight: 300,
  },
  [ToolType.SCENE]: {
    isScene: true,
    fillColor: '#000000',
    previewColor: '#000000',
    namePrefix: 'Scene',
    label: 'Create scene',
    defaultWidth: 1920,
    defaultHeight: 1080,
  },
  [ToolType.TEXT]: {
    fillColor: '#FFFFFF',
    previewColor: 'transparent',
    namePrefix: 'Text',
    label: 'Create text',
    // Width/height for click insertions are derived from the font size below.
    defaultWidth: 0,
    defaultHeight: 0,
  },
};

const CLICK_THRESHOLD = 10;

export function DrawOverlay() {
  const world = useWorld();
  const editor = useEditor();
  const selectedTool = useTool();

  let overlayRef!: HTMLDivElement;
  let previewRef!: HTMLDivElement;
  let dimensionsRef!: HTMLDivElement;

  let isDrawing = false;
  let startPoint: Point | null = null;
  let currentPoint: Point | null = null;
  let targetScene: Entity | null = null;

  const config = () => TOOL_CONFIG[selectedTool()];
  const isActiveTool = () => !!config();

  const getRect = () => {
    if (!startPoint || !currentPoint) return null;
    return {
      x: Math.min(startPoint.x, currentPoint.x),
      y: Math.min(startPoint.y, currentPoint.y),
      width: Math.abs(currentPoint.x - startPoint.x),
      height: Math.abs(currentPoint.y - startPoint.y),
    };
  };

  const updatePreview = () => {
    const cfg = config();
    const rect = getRect();
    if (!previewRef || !rect || !cfg) {
      if (previewRef) previewRef.style.display = 'none';
      if (dimensionsRef) dimensionsRef.style.display = 'none';
      return;
    }

    previewRef.style.display = 'block';
    previewRef.style.left = `${rect.x}px`;
    previewRef.style.top = `${rect.y}px`;
    previewRef.style.width = `${rect.width}px`;
    previewRef.style.height = `${rect.height}px`;
    previewRef.style.backgroundColor = cfg.previewColor;
    previewRef.style.outline = '2px solid #008CFF';
    previewRef.style.outlineOffset = '0px';

    const worldTopLeft = screenToWorld(world, rect.x, rect.y);
    const worldBottomRight = screenToWorld(world, rect.x + rect.width, rect.y + rect.height);
    const worldWidth = Math.round(worldBottomRight.x - worldTopLeft.x);
    const worldHeight = Math.round(worldBottomRight.y - worldTopLeft.y);

    dimensionsRef.style.display = 'block';
    dimensionsRef.style.left = `${rect.x + rect.width / 2}px`;
    dimensionsRef.style.top = `${rect.y + rect.height + 8}px`;
    dimensionsRef.textContent = `${worldWidth}x${worldHeight}`;
  };

  const getLocalPoint = (e: PointerEvent): Point => {
    const rect = overlayRef.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e: PointerEvent) => {
    if (!isActiveTool()) return;

    const point = getLocalPoint(e);
    const worldPt = screenToWorld(world, point.x, point.y);
    targetScene = findSceneAt(world, worldPt.x, worldPt.y);

    overlayRef.setPointerCapture(e.pointerId);
    isDrawing = true;
    startPoint = point;
    currentPoint = point;
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!isDrawing) return;
    currentPoint = getLocalPoint(e);
    updatePreview();
  };

  const reset = () => {
    isDrawing = false;
    startPoint = null;
    currentPoint = null;
    targetScene = null;
    updatePreview();
  };

  const handlePointerUp = () => {
    if (!isDrawing) return;

    const cfg = config();
    const rect = getRect();
    if (!cfg || !rect) {
      reset();
      return;
    }

    const tool = selectedTool();
    const isClick = rect.width < CLICK_THRESHOLD || rect.height < CLICK_THRESHOLD;

    const worldTopLeft = screenToWorld(world, rect.x, rect.y);
    const worldBottomRight = screenToWorld(world, rect.x + rect.width, rect.y + rect.height);

    // Approximate text size from the parent scene's height.
    let fontSize = 16;
    if (tool === ToolType.TEXT && targetScene !== null) {
      const sceneHeight = store(world, Computed).height[targetScene.id()] ?? 0;
      fontSize = Math.max(8, Math.round(sceneHeight / 22.5));
    }

    let width: number;
    let height: number;
    if (!isClick) {
      width = Math.round(worldBottomRight.x - worldTopLeft.x);
      height = Math.round(worldBottomRight.y - worldTopLeft.y);
    } else if (tool === ToolType.TEXT) {
      // Rough text bounds based on "Text" (4 chars) at the chosen font size.
      width = Math.round(fontSize * 0.6 * 4);
      height = Math.round(fontSize * 1.2);
    } else {
      width = cfg.defaultWidth;
      height = cfg.defaultHeight;
    }

    let posX = isClick ? worldTopLeft.x - width / 2 : worldTopLeft.x;
    let posY = isClick ? worldTopLeft.y - height / 2 : worldTopLeft.y;

    // Scenes always live at the root; rect/text may parent into a hovered scene.
    const parentScene = tool === ToolType.SCENE ? null : targetScene;
    if (parentScene !== null) {
      const local = worldToLocal(world, parentScene, posX, posY);
      posX = local.x;
      posY = local.y;
    }

    const parent = parentScene ?? world.get(Root)!;
    // Nothing to draw into until a project is mounted: the element would have
    // no file to be written to.
    if (!parent.get(Source)?.value) {
      reset();
      return;
    }

    const name = getNextName(world, cfg.namePrefix);
    const x = Math.round(posX);
    const y = Math.round(posY);
    // A clicked-in text sizes itself to its glyphs, so it takes no size.
    const size = tool !== ToolType.TEXT || !isClick ? { width, height } : {};

    const [entity] = editor.insertElement(parent, () => {
      if (cfg.isScene) {
        return (
          <Scene name={name} x={x} y={y} width={width} height={height}>
            <SolidPaint color={cfg.fillColor} />
          </Scene>
        );
      }
      if (tool === ToolType.TEXT) {
        return <Text name={name} x={x} y={y} {...size} fontSize={fontSize} color={cfg.fillColor}>Text</Text>;
      }
      return (
        <Rect name={name} x={x} y={y} {...size}>
          <SolidPaint color={cfg.fillColor} />
        </Rect>
      );
    });

    if (entity) {
      if (tool === ToolType.SCENE) {
        editor.activate(entity);
      }

      editor.select(entity);
    }

    world.set(Tool, { value: tool === ToolType.TEXT ? ToolType.TEXT_EDIT : ToolType.MOVE });
    reset();
  };

  return (
    <Show when={isActiveTool()}>
      <div
        ref={overlayRef}
        class="absolute inset-0 z-5 cursor-crosshair"
        on:pointerdown={handlePointerDown}
        on:pointermove={handlePointerMove}
        on:pointerup={handlePointerUp}
      >
        <div
          ref={previewRef}
          class="absolute pointer-events-none"
          style={{ display: 'none' }}
        />
        <div
          ref={dimensionsRef}
          class="absolute pointer-events-none"
          style={{
            display: 'none',
            transform: 'translateX(-50%)',
            'background-color': '#008CFF',
            color: '#FFFFFF',
            'font-family': 'Inter, sans-serif',
            'font-size': '11px',
            'line-height': '1',
            padding: '3px 4px',
            'border-radius': '3px',
            'white-space': 'nowrap',
          }}
        />
      </div>
    </Show>
  );
}
