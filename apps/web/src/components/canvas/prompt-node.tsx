/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { Not, Or } from "koota";
import { useQuery, useTrait, useWorld } from "@diffusionstudio/koota-solid";
import { generate, getAssetSpec } from "@diffusionstudio/jsx";
import { Audio, ImagePaint, Rect, VideoPaint, authoredElement } from "@diffusionstudio/reconciler";
import {
  AssetId, Background, Computed, Culled, DEFAULT_BACKGROUND, Geometry, Group, HitRegions, Hidden, Hovering, Name, PaintType, PromptNode,
  RenderSurface, Root, Selected, Sequential, Tool, ToolType, colorToHex, entityQuad, entityWorldMat, getEntityBounds, getMaskSelection,
  getParentEntity, getSelectionMask, invert2D, isPointerInEntity, multiply2D, pointInQuad, rectToQuad, store, transformPoint, translate2D,
} from "@diffusionstudio/runtime";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ASSET_DRAG_TYPE } from "@/components/sidebar-left/folder-item";
import { useEngineContext } from "@/engine";
import { droppedFiles, importFiles, pickFiles } from "@/engine/asset-actions";
import { useDerived, useEditor } from "@/engine/hooks";
import { useLibrary } from "@/engine/library";
import { useCursor } from "@/hooks/use-cursor";
import { getMountedNameInput } from "@/engine/hud/name-input";
import { AUDIO_SIZE } from "@/engine/insert-asset";
import { PROMPT_SCALE, PROMPT_SIZE, generateRef, generationOf, setPromptText, takePromptFocus, templateOf, withGeneration } from "@/engine/prompt";
import { getMarqueeQuad } from "@/engine/input/snapping";
import { Hud, Keys, Pointer, SnapLines } from "@/engine/traits";
import {
  ALL_DURATION_OPTIONS,
  ASPECT_RATIO_DIMENSIONS,
  ALL_VIDEO_ASPECT_RATIO_OPTIONS,
  PROMPT_INPUT_AUDIO_MODEL_OPTIONS,
  PROMPT_INPUT_IMAGE_ASPECT_RATIO_OPTIONS,
  PROMPT_INPUT_IMAGE_MODEL_OPTIONS,
  PROMPT_INPUT_MODE_OPTIONS,
  PROMPT_INPUT_VARIANT_COUNT_OPTIONS,
  PROMPT_INPUT_VIDEO_MODEL_OPTIONS,
  PROMPT_INPUT_VOICE_OPTIONS,
} from "@/components/genai/config";
import {
  DEFAULT_BUTTON_CLASS,
  MAX_IMAGE_REFERENCES,
  ModelMenu,
  PromptInputAttachButton,
  PromptInputCompactMenu,
  PromptInputReferenceImageButton,
  VoiceMenu,
  createDefaultConfig,
} from "@/components/genai/prompt-input";
import { insertGenerated, randomSeed } from "@/components/genai/insert";
import { toPromptConfig } from "@/components/genai/use-generation-records";
import { resolveMedia } from "@/components/genai/selection";

import type { AssetLibrary } from "@diffusionstudio/assets";
import type { AssetRef, GenerateSpec } from "@diffusionstudio/jsx";
import type { AABB, Point, Quad, SelectionMask } from "@diffusionstudio/runtime";
import type { Entity, World } from "koota";
import type { PromptInputMode } from "@/components/genai/prompt-input";
import type { AspectRatio, GenerationConfig } from "@/components/genai/schemas";

type Props = Record<string, unknown>;

const COMMIT_DELAY = 400;

const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);
const number = (value: unknown) => (typeof value === "number" ? value : undefined);

const LEGACY_PROPS = ["mode", "type", "prompt", "model", "aspectRatio", "refs", "startFrame", "endFrame", "duration", "audio", "voice"];

function legacyConfig(props: Props, library: AssetLibrary | undefined): GenerationConfig {
  const mode = (text(props.type) ?? text(props.mode) ?? "image").toUpperCase() as PromptInputMode;
  const base = createDefaultConfig(mode, text(props.prompt) ?? "");
  const idOf = (path: unknown) => {
    const value = text(path);
    return value ? library?.get(value)?.id : undefined;
  };

  switch (base.mode) {
    case "IMAGE":
      return {
        ...base,
        model: text(props.model) ?? base.model,
        aspectRatio: (text(props.aspectRatio) as AspectRatio | undefined) ?? base.aspectRatio,
        count: number(props.count) ?? base.count,
        imageRefIds: (Array.isArray(props.refs) ? props.refs : []).map(idOf).filter((id): id is string => id !== undefined),
      };
    case "VIDEO":
      return {
        ...base,
        model: text(props.model) ?? base.model,
        aspectRatio: (text(props.aspectRatio) as AspectRatio | undefined) ?? base.aspectRatio,
        duration: number(props.duration) ?? base.duration,
        generateAudio: props.audio === true,
        startFrameImageId: idOf(props.startFrame),
        endFrameImageId: idOf(props.endFrame),
      };
    case "VOICE":
      return { ...base, voice: text(props.voice) ?? base.voice };
    case "AUDIO":
      return { ...base, model: text(props.model) ?? base.model };
  }
}

function toConfig(props: Props, library: AssetLibrary | undefined): GenerationConfig {
  const template = templateOf(props.template);
  const generation = template && generationOf(template);
  if (!generation) return legacyConfig(props, library);
  const config = toPromptConfig(getAssetSpec(generation) as GenerateSpec, library);
  return config.mode === "IMAGE" ? { ...config, count: number(props.count) ?? 1 } : config;
}

function toGeneration(config: GenerationConfig, library: AssetLibrary | undefined): AssetRef {
  const pathOf = (id: string | undefined) => (id ? library?.get(id)?.path : undefined);

  switch (config.mode) {
    case "IMAGE": {
      const refs = (config.imageRefIds ?? []).map(pathOf).filter((path): path is string => path !== undefined);
      return generate.image({
        prompt: config.prompt,
        model: config.model,
        aspectRatio: config.aspectRatio,
        ...(refs.length ? { refs } : {}),
      });
    }
    case "VIDEO": {
      const startFrame = pathOf(config.startFrameImageId);
      const endFrame = pathOf(config.endFrameImageId);
      return generate.video({
        prompt: config.prompt,
        model: config.model,
        aspectRatio: config.aspectRatio,
        duration: config.duration,
        audio: config.generateAudio ?? false,
        ...(startFrame ? { startFrame } : {}),
        ...(endFrame ? { endFrame } : {}),
      });
    }
    case "VOICE":
      return generate.voice({ prompt: config.prompt, voice: config.voice });
    case "AUDIO":
      return generate.audio({ prompt: config.prompt, model: config.model });
  }
}

const unsetValue = (value: unknown) => value === undefined || value === false;
const sameValue = (a: unknown, b: unknown) =>
  (unsetValue(a) && unsetValue(b)) || JSON.stringify(a) === JSON.stringify(b);

const MIDDLE_BUTTON = 1;
const GESTURE_GAP = 250;
const DOUBLE_CLICK_WINDOW = 500;
const CONTROLS = "textarea, input, button, select, a, [role='button'], [role='menuitem'], [role='option']";

const isControl = (target: EventTarget | null) => target instanceof Element && target.closest(CONTROLS) !== null;

const delayedPresses = new WeakSet<PointerEvent>();

type Picking = { entity: Entity; pick(assetId: string): boolean };

const [picking, setPicking] = createSignal<Picking | null>(null);
const [pointerBox, setPointerBox] = createSignal<Entity | null>(null);

const zooming = (event: WheelEvent) => event.ctrlKey || event.metaKey;

function scrollableText(event: WheelEvent): HTMLTextAreaElement | null {
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement) || !target.closest("[data-prompt-node]") || zooming(event)) return null;
  return Math.abs(event.deltaY) >= Math.abs(event.deltaX) && target.scrollHeight > target.clientHeight ? target : null;
}

function sizeReadout(world: World, mask: SelectionMask, selection: Entity[]) {
  if (selection.length !== 1) {
    const inverse = invert2D(entityWorldMat(world, null));
    inverse.e = 0;
    inverse.f = 0;
    const size = transformPoint(inverse, mask.width, mask.height);
    return { x: mask.mat.e, y: mask.mat.f + mask.height, rotation: 0, center: mask.width / 2, width: size.x, height: size.y };
  }

  const eid = selection[0]!.id();
  const computed = store(world, Computed);
  const [left, right] = [...entityQuad(world, selection[0]!)].sort((a, b) => b.y - a.y).slice(0, 2).sort((a, b) => a.x - b.x);
  return {
    x: left!.x,
    y: left!.y,
    rotation: Math.atan2(right!.y - left!.y, right!.x - left!.x),
    center: Math.hypot(right!.x - left!.x, right!.y - left!.y) / 2,
    width: (computed.width[eid] ?? 0) * Math.abs(computed.scaleX[eid] ?? 1),
    height: (computed.height[eid] ?? 0) * Math.abs(computed.scaleY[eid] ?? 1),
  };
}

function handleQuads(mask: SelectionMask, resolution: number): Quad[] {
  const size = Math.round(8 * resolution);
  const offset = Math.round(size / 2);
  const corners: [number, number][] = [[-offset, -offset], [mask.width - offset, -offset], [mask.width - offset, mask.height - offset], [-offset, mask.height - offset]];
  return corners.map(([x, y]) => rectToQuad(multiply2D(mask.mat, translate2D(x, y)), size, size));
}

export function PromptNodes() {
  const world = useWorld();
  const library = useLibrary();
  const cursor = useCursor();
  const prompts = useQuery(PromptNode);
  const stacked = useDerived(
    () => {
      const order = new Map<Entity, number>();
      world.get(HitRegions)?.list.forEach((region, index) => {
        if (region.target.kind === "entity") order.set(region.target.id, index);
      });
      const layer = (entity: Entity | null): number => (entity ? order.get(entity) ?? layer(getParentEntity(entity)) : order.size);
      return [...prompts()].sort((a, b) => layer(a) - layer(b));
    },
    (a, b) => a.length === b.length && a.every((entity, index) => entity === b[index]),
  );
  const background = useTrait(world.get(Root)!, Background);
  const pressed = useDerived(() => world.get(Pointer)?.phase === "pressed");
  const { frame } = useEngineContext();

  let layer!: HTMLDivElement;
  let snapGuides!: SVGPathElement;
  let hoverOutlines!: SVGPathElement;
  let outline!: SVGPathElement;
  let handles!: SVGPathElement;
  let sizeBadge!: HTMLDivElement;
  let marquee!: SVGPathElement;
  let lastForwardedPress = -Infinity;
  let pendingPress: PointerEvent | null = null;

  const canvas = () => {
    const target = world.get(RenderSurface)?.canvas;
    return target instanceof HTMLCanvasElement ? target : undefined;
  };

  const flushPress = () => {
    const target = canvas();
    if (!pendingPress || !target) return;
    target.dispatchEvent(new PointerEvent("pointerdown", pendingPress));
    pendingPress = null;
  };

  createEffect(() => {
    frame();
    layer.style.cursor = canvas()?.style.cursor ?? "";
    flushPress();
  });

  createEffect(() => {
    frame();
    const resolution = world.get(RenderSurface)?.resolution ?? 1;
    const line = Math.round(resolution) / resolution;
    const at = (x: number, y: number) => `${x / resolution} ${y / resolution}`;
    const path = (quad: Quad) => `M${quad.map((point) => at(point.x, point.y)).join("L")}Z`;
    const keys = world.get(Keys)?.held;

    const cross = Math.round(3 * resolution);
    const crossAt = ({ x, y }: Point) => `M${at(x - cross, y - cross)}L${at(x + cross, y + cross)}M${at(x - cross, y + cross)}L${at(x + cross, y - cross)}`;
    const snaps = keys?.has("mod") ? [] : world.get(SnapLines)?.list ?? [];
    snapGuides.setAttribute("d", snaps.map(({ from, to }) => `M${at(from.x, from.y)}L${at(to.x, to.y)}${crossAt(from)}${crossAt(to)}`).join(""));
    snapGuides.setAttribute("stroke-width", `${line}`);

    const panning = world.get(Tool)?.value === ToolType.HAND || (keys?.has(" ") ?? false);
    const boxed = pointerBox();
    const hovered = panning ? [] : boxed?.isAlive() ? [boxed] : world.query(Hovering, Or(Geometry, Group), Not(Sequential), Not(Culled));
    hoverOutlines.setAttribute("d", hovered.map((entity) => path(entityQuad(world, entity))).join(""));
    hoverOutlines.setAttribute("stroke-width", `${Math.round(2 * resolution) / resolution}`);

    const mask = world.get(Hud)?.mode === "moving" ? null : getSelectionMask(world);
    const selection = mask ? getMaskSelection(world) : [];
    outline.setAttribute("d", mask ? [...selection.map((entity) => entityQuad(world, entity)), rectToQuad(mask.mat, mask.width, mask.height)].map(path).join("") : "");
    outline.setAttribute("stroke-width", `${(selection.length === 1 ? 2 : Math.round(resolution)) / resolution}`);
    handles.setAttribute("d", mask ? handleQuads(mask, resolution).map(path).join("") : "");
    handles.setAttribute("stroke-width", `${line}`);

    const marqueeQuad = getMarqueeQuad(world);
    marquee.setAttribute("d", marqueeQuad ? path(marqueeQuad) : "");
    marquee.setAttribute("stroke-width", `${line}`);

    sizeBadge.style.display = mask ? "" : "none";
    if (!mask) return;
    const { x, y, rotation, center, width, height } = sizeReadout(world, mask, selection);
    const text = `${Math.round(width * 100) / 100}x${Math.round(height * 100) / 100}`;
    if (sizeBadge.textContent !== text) sizeBadge.textContent = text;
    sizeBadge.style.transform = `translate(${x / resolution}px, ${y / resolution}px) rotate(${rotation}rad) translate(${center / resolution}px, 16px) translate(-50%, -9px)`;
  });

  onMount(() => {
    window.addEventListener("pointerup", flushPress, { capture: true });
    window.addEventListener("pointercancel", flushPress, { capture: true });
  });
  onCleanup(() => {
    window.removeEventListener("pointerup", flushPress, { capture: true });
    window.removeEventListener("pointercancel", flushPress, { capture: true });
  });

  let lastWheel = -Infinity;
  let textOwner: HTMLTextAreaElement | null = null;

  const trackGesture = (event: WheelEvent) => {
    if (!event.isTrusted) return;
    if (event.timeStamp - lastWheel > GESTURE_GAP) textOwner = scrollableText(event);
    lastWheel = event.timeStamp;
    if (textOwner && event.target !== textOwner && !zooming(event)) event.stopPropagation();
  };

  onMount(() => window.addEventListener("wheel", trackGesture, { capture: true, passive: true }));
  onCleanup(() => window.removeEventListener("wheel", trackGesture, { capture: true }));

  const handleWheel = (event: WheelEvent) => {
    const target = canvas();
    if (!target || (event.target === textOwner && !zooming(event))) return;
    event.preventDefault();
    target.dispatchEvent(new WheelEvent(event.type, event));
  };

  const handlePointerDown = (event: PointerEvent) => {
    const target = canvas();
    if (!target) return;
    const pans = event.button === MIDDLE_BUTTON || world.get(Tool)?.value === ToolType.HAND;
    if (!pans && (event.button !== 0 || isControl(event.target))) return;
    event.preventDefault();
    if (!pans && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    lastForwardedPress = event.timeStamp;
    if (delayedPresses.has(event)) pendingPress = event;
    else target.dispatchEvent(new PointerEvent(event.type, event));
  };

  const forwardDoubleClick = (event: MouseEvent) => {
    const target = canvas();
    if (!target || !event.isTrusted || event.target === target) return;
    if (event.timeStamp - lastForwardedPress > DOUBLE_CLICK_WINDOW) return;
    target.dispatchEvent(new MouseEvent(event.type, event));
  };

  onMount(() => window.addEventListener("dblclick", forwardDoubleClick));
  onCleanup(() => window.removeEventListener("dblclick", forwardDoubleClick));

  const handlePointerMove = (event: PointerEvent) => {
    canvas()?.dispatchEvent(new PointerEvent(event.type, event));
  };

  const imageAt = (event: PointerEvent): string | undefined => {
    const target = canvas();
    if (!target) return undefined;
    const rect = target.getBoundingClientRect();
    const resolution = world.get(RenderSurface)?.resolution ?? 1;
    const point = { x: (event.clientX - rect.left) * resolution, y: (event.clientY - rect.top) * resolution };
    const regions = world.get(HitRegions)?.list ?? [];

    for (let index = regions.length - 1; index >= 0; index--) {
      const { target: hit } = regions[index]!;
      if (hit.kind !== "entity" || !hit.id.isAlive() || !isPointerInEntity(world, hit.id, point)) continue;
      const { source, paint } = resolveMedia(hit.id);
      const assetId = paint === PaintType.IMAGE ? source.get(AssetId)?.value : undefined;
      return assetId && library()?.get(assetId)?.type === "IMAGE" ? assetId : undefined;
    }
    return undefined;
  };

  const handlePick = (event: PointerEvent) => {
    const current = picking();
    if (!current || event.button !== 0 || world.get(Tool)?.value === ToolType.HAND) return;
    event.preventDefault();
    event.stopPropagation();
    const assetId = imageAt(event);
    if (!assetId || !current.pick(assetId)) setPicking(null);
  };

  const stopPicking = (event: KeyboardEvent) => {
    if ((event.key !== "Escape" && event.key !== "Enter") || !picking()) return;
    event.preventDefault();
    event.stopPropagation();
    setPicking(null);
  };

  onMount(() => window.addEventListener("keydown", stopPicking, { capture: true }));
  onCleanup(() => window.removeEventListener("keydown", stopPicking, { capture: true }));

  return (
    <div
      ref={layer}
      class="pointer-events-none absolute inset-0 overflow-hidden"
      classList={{ "[&_*]:pointer-events-none!": pressed() }}
      style={{ "--canvas-background": colorToHex(background()?.value ?? DEFAULT_BACKGROUND) }}
      on:wheel={handleWheel}
      on:pointerdown={handlePointerDown}
      on:pointermove={handlePointerMove}
    >
      <For each={stacked()}>
        {(entity) => <PromptNodeBox entity={entity} />}
      </For>
      <svg class="absolute inset-0 z-[1] size-full">
        <path ref={snapGuides} fill="none" stroke="#F43535" />
        <path ref={hoverOutlines} fill="none" stroke="#008CFF" />
        <path ref={outline} fill="none" stroke="#008CFF" />
        <path ref={handles} fill="#FFFFFF" stroke="#008CFF" />
      </svg>
      <div
        ref={sizeBadge}
        class="absolute left-0 top-0 z-[1] h-4 origin-top-left whitespace-nowrap rounded-[3px] bg-[#008CFF] px-1 text-white"
        style={{ font: "11px/18px Inter, sans-serif" }}
      />
      <svg class="absolute inset-0 z-[1] size-full">
        <path ref={marquee} fill="#008CFF" fill-opacity="0.15" stroke="#008CFF" />
      </svg>
      <div
        ref={(element) => cursor.set(element, "pick")}
        class="pointer-events-auto absolute inset-0"
        classList={{ hidden: !picking() }}
        on:pointerdown={handlePick}
      />
    </div>
  );
}

function AttachMenu(props: { icon: string; label: string; class: string; onPick(): void; onUpload(): void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger as={PromptInputAttachButton} icon={props.icon} label={props.label} class={props.class} />
      <DropdownMenuPortal>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={props.onPick}>
            <Icon name="tool.color-picker" class="size-6 mr-2 text-foreground" />
            Pick from canvas
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={props.onUpload}>
            <Icon name="attachment" class="size-6 mr-2 text-foreground" />
            Upload from computer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}

function PromptNodeBox(props: { entity: Entity }) {
  const world = useWorld();
  const editor = useEditor();
  const library = useLibrary();
  const { frame } = useEngineContext();

  let box!: HTMLDivElement;
  let label!: HTMLDivElement;
  let textarea!: HTMLTextAreaElement;
  let commitTimer: ReturnType<typeof setTimeout> | undefined;

  const authored = useDerived(
    () => ({ ...(authoredElement(props.entity)?.props ?? {}) }) as Props,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const selected = useDerived(() => props.entity.has(Selected));
  const name = useDerived(() => (getParentEntity(props.entity) === world.get(Root) ? props.entity.get(Name)?.value ?? "" : ""));
  const config = createMemo(() => toConfig(authored(), library()));

  const [draft, setDraft] = createSignal(config().prompt);
  const [settingsVisible, setSettingsVisible] = createSignal(true);
  const [isDragging, setIsDragging] = createSignal(false);

  createEffect(on(() => config().prompt, (prompt) => {
    if (document.activeElement !== textarea) setDraft(prompt);
  }));

  createEffect(() => {
    frame();
    const matrix = entityWorldMat(world, props.entity);
    const computed = store(world, Computed);
    const eid = props.entity.id();
    const resolution = world.get(RenderSurface)?.resolution ?? 1;
    const scale = PROMPT_SCALE / resolution;
    const screenScale = Math.hypot(matrix.a, matrix.b) * scale;
    const layoutWidth = (computed.width[eid] ?? PROMPT_SIZE.width) / PROMPT_SCALE;

    box.style.width = `${layoutWidth}px`;
    box.style.height = `${(computed.height[eid] ?? PROMPT_SIZE.height) / PROMPT_SCALE}px`;
    box.style.transform = `matrix(${matrix.a * scale}, ${matrix.b * scale}, ${matrix.c * scale}, ${matrix.d * scale}, ${matrix.e / resolution}, ${matrix.f / resolution})`;
    box.style.display = props.entity.has(Hidden) || props.entity.has(Culled) ? "none" : "";
    label.style.transform = `scale(${1 / screenScale}) translateY(-22px)`;
    label.style.maxWidth = `${layoutWidth * screenScale + 4}px`;
    label.style.visibility = getMountedNameInput()?.entity === props.entity ? "hidden" : "";

    if (takePromptFocus(props.entity)) textarea.focus({ preventScroll: true });
  });

  const templateFor = (next: GenerationConfig): AssetRef => {
    const generation = toGeneration(next, library());
    const previous = templateOf(authored().template);
    if (!previous) return generation;
    const current = generationOf(previous);
    const sameKind = current !== undefined && getAssetSpec(current).type === next.mode.toLowerCase();
    return sameKind ? withGeneration(previous, generation) : generation;
  };

  const write = (next: GenerationConfig) => {
    const current = authored();
    const template = templateFor(next);
    if (!sameValue(templateOf(current.template), template)) editor.editProperty(props.entity, "template", template);

    const count = next.mode === "IMAGE" ? next.count : false;
    if (!sameValue(current.count, count)) editor.editProperty(props.entity, "count", count);

    for (const name of LEGACY_PROPS) {
      if (!unsetValue(current[name])) editor.editProperty(props.entity, name, false);
    }
  };

  const patch = (updates: Partial<GenerationConfig>) => {
    write({ ...config(), prompt: draft(), ...updates } as GenerationConfig);
  };

  const commitPrompt = () => {
    clearTimeout(commitTimer);
    if (draft() === config().prompt) return;
    if (templateOf(authored().template)) setPromptText(editor, props.entity, draft());
    else write({ ...config(), prompt: draft() } as GenerationConfig);
  };

  onCleanup(() => clearTimeout(commitTimer));
  onCleanup(() => {
    if (picking()?.entity === props.entity) setPicking(null);
  });

  const leaveBox = () => {
    if (pointerBox() === props.entity) setPointerBox(null);
  };
  onCleanup(leaveBox);

  createEffect(on(picking, (current, previous) => {
    if (!current && previous?.entity === props.entity) textarea.focus({ preventScroll: true });
  }, { defer: true }));

  const select = () => {
    if (!props.entity.has(Selected)) editor.select([props.entity]);
  };

  const canvasHitsThis = (event: PointerEvent): boolean => {
    const surface = world.get(RenderSurface);
    if (!(surface?.canvas instanceof HTMLCanvasElement)) return false;
    const rect = surface.canvas.getBoundingClientRect();
    const point = { x: (event.clientX - rect.left) * surface.resolution, y: (event.clientY - rect.top) * surface.resolution };
    const regions = world.get(HitRegions)?.list ?? [];

    for (let index = regions.length - 1; index >= 0; index--) {
      const { target } = regions[index]!;
      if (target.kind === "entity") {
        if (target.id.isAlive() && isPointerInEntity(world, target.id, point)) return target.id === props.entity;
      } else if (pointInQuad(point.x, point.y, target.quad)) {
        return target.entity === props.entity;
      }
    }
    return false;
  };

  const handlePress = (event: PointerEvent) => {
    if (event.button !== 0 || isControl(event.target) || world.get(Tool)?.value === ToolType.HAND) return;
    if (props.entity.has(Selected) || canvasHitsThis(event)) return;
    editor.select(props.entity, { extend: event.shiftKey });
    world.set(Hud, { mode: "moving" });
    delayedPresses.add(event);
  };

  const imageConfig = () => {
    const current = config();
    return current.mode === "IMAGE" ? current : undefined;
  };
  const videoConfig = () => {
    const current = config();
    return current.mode === "VIDEO" ? current : undefined;
  };
  const voiceConfig = () => {
    const current = config();
    return current.mode === "VOICE" ? current : undefined;
  };

  const currentVideoModel = createMemo(() => PROMPT_INPUT_VIDEO_MODEL_OPTIONS.find((model) => model.id === config().model));
  const videoDurationOptions = createMemo(() => {
    const model = currentVideoModel();
    return model ? ALL_DURATION_OPTIONS.filter((option) => model.durations.includes(option.value)) : [];
  });
  const videoAspectRatioOptions = createMemo(() => {
    const model = currentVideoModel();
    return model ? ALL_VIDEO_ASPECT_RATIO_OPTIONS.filter((option) => model.aspectRatios.includes(option.value)) : [];
  });

  const imageRefIds = () => (imageConfig()?.imageRefIds ?? []).slice(0, MAX_IMAGE_REFERENCES);
  const frameId = (frame: "start" | "end") => {
    if (!currentVideoModel()?.features.includes(`${frame}-frame`)) return undefined;
    return frame === "start" ? videoConfig()?.startFrameImageId : videoConfig()?.endFrameImageId;
  };

  const frameAsset = (frame: "start" | "end") => {
    const id = frameId(frame);
    return id ? library()?.get(id) : undefined;
  };

  const handleModeChange = (value: string) => {
    const mode = value as PromptInputMode;
    if (mode === config().mode) return;
    write(createDefaultConfig(mode, draft()));
  };

  const handleVideoModelChange = (id: string) => {
    const model = PROMPT_INPUT_VIDEO_MODEL_OPTIONS.find((option) => option.id === id);
    const current = videoConfig();
    if (!model || !current) return;

    write({
      ...current,
      prompt: draft(),
      model: id,
      endFrameImageId: model.features.includes("end-frame") ? current.endFrameImageId : undefined,
      generateAudio: model.features.includes("audio") ? current.generateAudio : false,
      duration: model.durations.includes(`${current.duration}s`) ? current.duration : parseInt(model.durations[0], 10),
      aspectRatio: model.aspectRatios.includes(current.aspectRatio) ? current.aspectRatio : (model.aspectRatios[0] as AspectRatio),
    });
  };

  const addImages = (ids: string[]) => {
    const current = videoConfig();
    if (current) {
      const [first, second] = ids;
      patch({
        startFrameImageId: current.startFrameImageId ?? first,
        endFrameImageId: current.endFrameImageId ?? (current.startFrameImageId ? first : second),
      });
      return;
    }
    if (imageConfig()) patch({ imageRefIds: [...imageRefIds(), ...ids].slice(0, MAX_IMAGE_REFERENCES) });
  };

  const pickImages = async (multiple = true) => {
    const lib = library();
    if (!lib) return [];
    const files = await pickFiles({ accept: "image/*", multiple });
    if (files.length === 0) return [];
    return (await importFiles(lib, files, "")).filter((asset) => asset.type === "IMAGE").map((asset) => asset.id);
  };

  const openImageReferencesPicker = async () => {
    addImages(await pickImages());
  };

  const openVideoFramePicker = async (frame: "start" | "end") => {
    const [id] = await pickImages(false);
    if (id) patch(frame === "start" ? { startFrameImageId: id } : { endFrameImageId: id });
  };

  const pickReferencesFromCanvas = () => setPicking({
    entity: props.entity,
    pick: (assetId) => {
      if (!imageConfig()) return false;
      const refs = imageRefIds();
      const next = refs.includes(assetId) ? refs : [...refs, assetId];
      patch({ imageRefIds: next });
      return next.length < MAX_IMAGE_REFERENCES;
    },
  });

  const pickFrameFromCanvas = (frame: "start" | "end") => setPicking({
    entity: props.entity,
    pick: (assetId) => {
      if (videoConfig()) patch(frame === "start" ? { startFrameImageId: assetId } : { endFrameImageId: assetId });
      return false;
    },
  });

  const handleDrop = async (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);

    const lib = library();
    if (!lib || (config().mode !== "IMAGE" && config().mode !== "VIDEO")) return;

    const assetIds = event.dataTransfer?.getData(ASSET_DRAG_TYPE)?.split(",").filter(Boolean) ?? [];
    const files = droppedFiles(event).filter((file) => file.type.startsWith("image/"));
    const ids = assetIds.length > 0 ? assetIds : (await importFiles(lib, files, "")).map((asset) => asset.id);
    addImages(ids.filter((id) => lib.get(id)?.type === "IMAGE"));
  };

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  };

  const handleInput = (event: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
    setDraft(event.currentTarget.value);
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commitPrompt, COMMIT_DELAY);
  };

  const handleSubmit = () => {
    commitPrompt();
    const next = { ...config(), prompt: draft().trim() } as GenerationConfig;
    if (!next.prompt) return;
    if (next.mode === "IMAGE") next.imageRefIds = imageRefIds();
    if (next.mode === "VIDEO") {
      next.startFrameImageId = frameId("start");
      next.endFrameImageId = frameId("end");
    }

    const template = templateFor(next);
    const generation = generationOf(template);
    if (!generation) return;

    const spec = getAssetSpec(generation) as GenerateSpec;
    const count = next.mode === "IMAGE" ? next.count : 1;
    const sources = Array.from({ length: count }, () => withGeneration(template, generateRef({ ...spec, seed: randomSeed() })));

    const bounds = getEntityBounds(world, [props.entity]);
    const near: AABB | undefined = bounds
      ? { minX: bounds.x, minY: bounds.y, maxX: bounds.x + bounds.width, maxY: bounds.y + bounds.height }
      : undefined;

    if (spec.type === "image" || spec.type === "video") {
      const size = ASPECT_RATIO_DIMENSIONS[spec.aspectRatio ?? "16:9"] ?? { width: 1920, height: 1080 };
      insertGenerated(world, editor, size, (box, index) => (
        <Rect keepAspectRatio x={box.x} y={box.y} width={box.width} height={box.height}>
          {spec.type === "image" ? <ImagePaint src={sources[index]} /> : <VideoPaint src={sources[index]} />}
        </Rect>
      ), count, sources, near);
      return;
    }

    insertGenerated(world, editor, AUDIO_SIZE, (box, index) => (
      <Audio src={sources[index]} x={box.x} y={box.y} width={box.width} height={box.height} />
    ), count, sources, near);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      handleSubmit();
    } else if (event.key === "Escape") {
      textarea.blur();
    }
  };

  return (
    <div
      ref={box}
      data-prompt-node
      class="pointer-events-auto absolute left-0 top-0 z-[1] flex origin-top-left flex-col gap-2 rounded-xl border border-border p-2 [background:linear-gradient(var(--input),var(--input)),var(--canvas-background)]"
      on:pointerdown={handlePress}
      on:pointerenter={() => setPointerBox(props.entity)}
      on:pointerleave={leaveBox}
    >
      <div
        ref={label}
        class="absolute -left-px -top-px h-[22px] w-max origin-top-left truncate pt-[3px] pr-1"
        classList={{ hidden: !name() }}
        style={{ font: "350 11px/11px Inter, sans-serif", color: selected() ? "#cce8ff" : "rgba(242, 242, 242, 0.64)" }}
      >
        {name()}
      </div>
      <Switch>
        <Match when={imageConfig()}>
          <div class="pointer-events-auto flex w-fit max-w-full items-start gap-2 overflow-x-auto">
            <For each={imageRefIds()}>
              {(assetId) => (
                <Show when={library()?.get(assetId)}>
                  {(asset) => (
                    <PromptInputReferenceImageButton
                      asset={asset()}
                      cache={library()!.cache}
                      class="size-16"
                      size={{ width: 64, height: 64 }}
                      onRemove={() => patch({ imageRefIds: imageRefIds().filter((id) => id !== assetId) })}
                    />
                  )}
                </Show>
              )}
            </For>
            <Show when={imageRefIds().length < MAX_IMAGE_REFERENCES}>
              <AttachMenu
                icon="attachment"
                label="Image references"
                class="w-36"
                onPick={pickReferencesFromCanvas}
                onUpload={openImageReferencesPicker}
              />
            </Show>
          </div>
        </Match>
        <Match when={videoConfig()}>
          <div class="pointer-events-auto flex w-fit max-w-full items-center gap-2 overflow-x-auto">
            <For each={["start", "end"] as const}>
              {(frame) => (
                <Show when={currentVideoModel()?.features.includes(`${frame}-frame`)}>
                  <Show
                    when={frameAsset(frame)}
                    fallback={
                      <AttachMenu
                        icon="image"
                        label={frame === "start" ? "Start frame" : "End frame"}
                        class="w-28"
                        onPick={() => pickFrameFromCanvas(frame)}
                        onUpload={() => openVideoFramePicker(frame)}
                      />
                    }
                  >
                    {(asset) => (
                      <PromptInputReferenceImageButton
                        asset={asset()}
                        cache={library()!.cache}
                        class="h-16 w-28"
                        size={{ width: 112, height: 64 }}
                        onRemove={() => patch(frame === "start" ? { startFrameImageId: undefined } : { endFrameImageId: undefined })}
                      />
                    )}
                  </Show>
                </Show>
              )}
            </For>
          </div>
        </Match>
      </Switch>

      <div class="flex min-h-14 w-full flex-1 p-1">
        <textarea
          ref={textarea}
          class="pointer-events-auto min-h-8 size-full resize-none overflow-y-auto overscroll-contain bg-transparent px-1 py-1 text-xs text-foreground placeholder:text-muted-foreground outline-none"
          placeholder="Describe what you want to create."
          value={draft()}
          onInput={handleInput}
          onBlur={commitPrompt}
          onFocus={select}
          onKeyDown={handleKeyDown}
          onDragOver={handleDragOver}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        />
      </div>

      <div class="flex min-h-4 w-full items-center justify-between">
        <div class="pointer-events-auto flex min-w-0 items-center gap-1 overflow-x-auto pr-1">
          <PromptInputCompactMenu
            aria-label="Select prompt mode"
            menuLabel="Generate"
            value={() => config().mode}
            options={PROMPT_INPUT_MODE_OPTIONS}
            onChange={handleModeChange}
          />
          <Tooltip>
            <TooltipTrigger
              as={Button}
              variant="ghost"
              size="icon-square"
              class="text-muted-foreground"
              onClick={() => setSettingsVisible(!settingsVisible())}
            >
              <Icon name="preferences-adjust" class="size-6" />
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
          <Show when={settingsVisible()}>
            <Separator orientation="vertical" class="min-h-5" />
            <Switch>
              <Match when={imageConfig()}>
                {(image) => (
                  <>
                    <ModelMenu
                      searchPlaceholder="Search in image models"
                      options={PROMPT_INPUT_IMAGE_MODEL_OPTIONS}
                      value={() => image().model}
                      onChange={(model) => patch({ model })}
                    />
                    <PromptInputCompactMenu
                      aria-label="Select aspect ratio"
                      menuLabel="Aspect ratio"
                      value={() => image().aspectRatio}
                      options={PROMPT_INPUT_IMAGE_ASPECT_RATIO_OPTIONS}
                      onChange={(value) => patch({ aspectRatio: value as AspectRatio })}
                      triggerIcon="aspect-ratio-16-9"
                    />
                    <PromptInputCompactMenu
                      aria-label="Select amount of variants"
                      menuLabel="Amount of variants"
                      value={() => String(image().count)}
                      options={PROMPT_INPUT_VARIANT_COUNT_OPTIONS}
                      onChange={(value) => patch({ count: Number(value) })}
                      triggerIcon="variants"
                    />
                  </>
                )}
              </Match>
              <Match when={videoConfig()}>
                {(video) => (
                  <>
                    <ModelMenu
                      searchPlaceholder="Search in video models"
                      options={PROMPT_INPUT_VIDEO_MODEL_OPTIONS}
                      value={() => video().model}
                      onChange={handleVideoModelChange}
                    />
                    <PromptInputCompactMenu
                      aria-label="Select aspect ratio"
                      menuLabel="Aspect ratio"
                      value={() => video().aspectRatio}
                      options={videoAspectRatioOptions()}
                      onChange={(value) => patch({ aspectRatio: value as AspectRatio })}
                      triggerIcon="aspect-ratio-16-9"
                    />
                    <PromptInputCompactMenu
                      aria-label="Select duration"
                      menuLabel="Duration"
                      value={() => `${video().duration}s`}
                      options={videoDurationOptions()}
                      onChange={(value) => patch({ duration: parseInt(value, 10) })}
                      triggerIcon="duration"
                    />
                    <Show when={currentVideoModel()?.features.includes("audio")}>
                      <Button
                        variant="ghost"
                        onClick={() => patch({ generateAudio: !video().generateAudio })}
                        class={DEFAULT_BUTTON_CLASS}
                      >
                        <Icon name={video().generateAudio ? "audio-on" : "audio-off"} class="size-6" />
                        {video().generateAudio ? "On" : "Off"}
                      </Button>
                    </Show>
                  </>
                )}
              </Match>
              <Match when={voiceConfig()}>
                {(voice) => (
                  <VoiceMenu
                    options={PROMPT_INPUT_VOICE_OPTIONS}
                    value={() => voice().voice}
                    onChange={(value) => patch({ voice: value })}
                  />
                )}
              </Match>
              <Match when={config().mode === "AUDIO"}>
                <ModelMenu
                  searchPlaceholder="Search in audio models"
                  options={PROMPT_INPUT_AUDIO_MODEL_OPTIONS}
                  value={() => config().model}
                  onChange={(model) => patch({ model })}
                />
              </Match>
            </Switch>
          </Show>
        </div>
        <Tooltip>
          <TooltipTrigger
            as={Button}
            variant="default"
            size="icon-square"
            class="pointer-events-auto"
            disabled={!draft().trim()}
            onClick={handleSubmit}
          >
            <Icon name="arrow-right" class="-rotate-90 size-6" />
          </TooltipTrigger>
          <TooltipContent shortcut="⌘↵">Generate</TooltipContent>
        </Tooltip>
      </div>

      <Show when={isDragging()}>
        <div class="absolute inset-0 z-20 overflow-hidden rounded-xl border border-primary bg-background p-2">
          <div class="absolute inset-0 rounded-xl bg-accent/40" />
          <div class="flex size-full items-center justify-center rounded-md border border-dashed border-border-input">
            <Icon name="attachment" class="size-6 text-muted-foreground" />
            <span class="text-xs font-450 text-muted-foreground">Drop images here</span>
          </div>
        </div>
      </Show>
    </div>
  );
}
