/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { useQuery, useWorld } from "@diffusionstudio/koota-solid";
import { authoredElement } from "@diffusionstudio/reconciler";
import {
  Computed, Culled, Hidden, PromptNode, RenderSurface, Selected, Tool, ToolType, entityWorldMat, getEntityBounds, store,
} from "@diffusionstudio/runtime";
import { toast } from "somoto";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ASSET_DRAG_TYPE } from "@/components/sidebar-left/folder-item";
import { useEngineContext } from "@/engine";
import { droppedFiles, importFiles, pickFiles } from "@/engine/asset-actions";
import { useDerived, useEditor } from "@/engine/hooks";
import { useLibrary } from "@/engine/library";
import { PROMPT_SCALE, PROMPT_SIZE, takePromptFocus } from "@/engine/prompt";
import {
  ALL_DURATION_OPTIONS,
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
import { useGenerateImage } from "@/components/genai/use-generate-image";
import { useGenerateVideo } from "@/components/genai/use-generate-video";
import { useGenerateVoice } from "@/components/genai/use-generate-voice";
import { useGenerateAudio } from "@/components/genai/use-generate-audio";

import type { AssetLibrary } from "@diffusionstudio/assets";
import type { PropValue } from "@diffusionstudio/jsx";
import type { AABB } from "@diffusionstudio/runtime";
import type { Entity } from "koota";
import type { PromptInputMode } from "@/components/genai/prompt-input";
import type { AspectRatio, GenerationConfig } from "@/components/genai/schemas";

type Props = Record<string, unknown>;

const COMMIT_DELAY = 400;

const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);
const number = (value: unknown) => (typeof value === "number" ? value : undefined);

function toConfig(props: Props, library: AssetLibrary | undefined): GenerationConfig {
  const mode = (text(props.mode) ?? "image").toUpperCase() as PromptInputMode;
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

function toProps(config: GenerationConfig, library: AssetLibrary | undefined): Record<string, PropValue> {
  const pathOf = (id: string | undefined) => (id && library?.get(id)?.path) || false;
  const unset = { aspectRatio: false, count: false, refs: false, startFrame: false, endFrame: false, duration: false, audio: false, voice: false };
  const common = { ...unset, mode: config.mode.toLowerCase(), prompt: config.prompt, model: config.model };

  switch (config.mode) {
    case "IMAGE": {
      const refs = (config.imageRefIds ?? []).map(pathOf).filter((path): path is string => path !== false);
      return { ...common, aspectRatio: config.aspectRatio, count: config.count, refs: refs.length ? refs : false };
    }
    case "VIDEO":
      return {
        ...common,
        aspectRatio: config.aspectRatio,
        duration: config.duration,
        audio: config.generateAudio ?? false,
        startFrame: pathOf(config.startFrameImageId),
        endFrame: pathOf(config.endFrameImageId),
      };
    case "VOICE":
      return { ...common, voice: config.voice };
    case "AUDIO":
      return common;
  }
}

const unsetValue = (value: unknown) => value === undefined || value === false;
const sameValue = (a: unknown, b: unknown) =>
  (unsetValue(a) && unsetValue(b)) || JSON.stringify(a) === JSON.stringify(b);

const MIDDLE_BUTTON = 1;
const GESTURE_GAP = 250;

const zooming = (event: WheelEvent) => event.ctrlKey || event.metaKey;

function scrollableText(event: WheelEvent): HTMLTextAreaElement | null {
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement) || !target.closest("[data-prompt-node]") || zooming(event)) return null;
  return Math.abs(event.deltaY) >= Math.abs(event.deltaX) && target.scrollHeight > target.clientHeight ? target : null;
}

export function PromptNodes() {
  const world = useWorld();
  const prompts = useQuery(PromptNode);

  const canvas = () => {
    const target = world.get(RenderSurface)?.canvas;
    return target instanceof HTMLCanvasElement ? target : undefined;
  };

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
    if (!target || (event.button !== MIDDLE_BUTTON && world.get(Tool)?.value !== ToolType.HAND)) return;
    event.preventDefault();
    target.dispatchEvent(new PointerEvent(event.type, event));
  };

  return (
    <div
      class="pointer-events-none absolute inset-0 overflow-hidden"
      on:wheel={handleWheel}
      on:pointerdown={handlePointerDown}
    >
      <For each={prompts()}>
        {(entity) => <PromptNodeBox entity={entity} />}
      </For>
    </div>
  );
}

function PromptNodeBox(props: { entity: Entity }) {
  const world = useWorld();
  const editor = useEditor();
  const library = useLibrary();
  const { frame } = useEngineContext();
  const { generate: generateImage } = useGenerateImage();
  const { generate: generateVideo } = useGenerateVideo();
  const { generate: generateVoice } = useGenerateVoice();
  const { generate: generateAudio } = useGenerateAudio();

  let box!: HTMLDivElement;
  let textarea!: HTMLTextAreaElement;
  let commitTimer: ReturnType<typeof setTimeout> | undefined;

  const authored = useDerived(
    () => ({ ...(authoredElement(props.entity)?.props ?? {}) }) as Props,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );
  const selected = useDerived(() => props.entity.has(Selected));
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

    box.style.width = `${(computed.width[eid] ?? PROMPT_SIZE.width) / PROMPT_SCALE}px`;
    box.style.height = `${(computed.height[eid] ?? PROMPT_SIZE.height) / PROMPT_SCALE}px`;
    box.style.transform = `matrix(${matrix.a * scale}, ${matrix.b * scale}, ${matrix.c * scale}, ${matrix.d * scale}, ${matrix.e / resolution}, ${matrix.f / resolution})`;
    box.style.display = props.entity.has(Hidden) || props.entity.has(Culled) ? "none" : "";

    if (takePromptFocus(props.entity)) textarea.focus({ preventScroll: true });
  });

  const write = (next: GenerationConfig) => {
    const current = authored();
    for (const [name, value] of Object.entries(toProps(next, library()))) {
      if (!sameValue(current[name], value)) editor.editProperty(props.entity, name, value);
    }
  };

  const patch = (updates: Partial<GenerationConfig>) => {
    write({ ...config(), prompt: draft(), ...updates } as GenerationConfig);
  };

  const commitPrompt = () => {
    clearTimeout(commitTimer);
    if (draft() !== config().prompt) editor.editProperty(props.entity, "prompt", draft());
  };

  onCleanup(() => clearTimeout(commitTimer));

  const select = () => {
    if (!props.entity.has(Selected)) editor.select([props.entity]);
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
    const current = { ...config(), prompt: draft().trim() } as GenerationConfig;
    if (!current.prompt) return;

    const bounds = getEntityBounds(world, [props.entity]);
    const near: AABB | undefined = bounds
      ? { minX: bounds.x, minY: bounds.y, maxX: bounds.x + bounds.width, maxY: bounds.y + bounds.height }
      : undefined;

    const promise = (() => {
      switch (current.mode) {
        case "IMAGE":
          return generateImage({ ...current, imageRefIds: imageRefIds() }, near);
        case "VIDEO":
          return generateVideo({ ...current, startFrameImageId: frameId("start"), endFrameImageId: frameId("end") }, near);
        case "VOICE":
          return generateVoice(current, near);
        case "AUDIO":
          return generateAudio(current, near);
      }
    })();

    promise.catch((error) => {
      toast("Generation failed", { description: error instanceof Error ? error.message : String(error) });
    });
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
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
      class="pointer-events-none absolute left-0 top-0 z-[1] flex origin-top-left flex-col gap-2 rounded-xl border bg-input p-2"
      classList={{ "border-primary": selected(), "border-border": !selected() }}
    >
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
              <PromptInputAttachButton icon="attachment" label="Image references" class="w-36" onClick={openImageReferencesPicker} />
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
                      <PromptInputAttachButton
                        icon="image"
                        label={frame === "start" ? "Start frame" : "End frame"}
                        class="w-28"
                        onClick={() => openVideoFramePicker(frame)}
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
          <TooltipContent shortcut="↵">Generate</TooltipContent>
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
