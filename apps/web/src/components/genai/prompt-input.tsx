/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { RemoveButton } from "@/components/ui/remove-button";
import { SearchInput } from "@/components/ui/search-input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Slider, SliderFill, SliderThumb, SliderTrack } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cx } from "@/lib/cva";
import {
  For,
  Show,
  Match,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
  type Accessor,
  type JSX,
} from "solid-js";

import {
  ASPECT_RATIO_OPTIONS,
  PROMPT_INPUT_MODE_OPTIONS,
  RESOLUTION_OPTIONS,
  defaultModelOption,
  durationsAt,
  modelOption,
  modelOptions,
  type AspectRatio,
  type PromptMode,
} from "./config";
import { createDefaultConfig, fitToModel } from "./requests";
import { loadConfig, saveConfig } from "./saved-config";
import { createStoredSignal } from "@/lib/store";
import { store } from "@/init";
import { useGenerate } from "./use-generate";
import { useEstimate } from "./use-estimate";
import { PromptInputActions } from "./prompt-input-actions";
import type { GenerationConfig } from "./types";
import { AssetThumbnail } from "@/components/ui/asset-thumbnail";
import { useLibrary } from "@/engine/library";
import { useEditor } from "@/engine/hooks";
import { droppedFiles, importFiles, pickFiles } from "@/engine/asset-actions";
import { useMediaSelection } from "./selection";
import { ASSET_DRAG_TYPE } from "@/components/sidebar-left/folder-item";

import type { ModelId, Resolution } from "@diffusionstudio/api-contract";
import type { AssetCache } from "@diffusionstudio/assets";
import type { ThumbnailAsset } from "@/components/ui/asset-thumbnail";


const DEFAULT_BUTTON_CLASS = "text-muted-foreground gap-0 pr-2 pl-0";
/** As many references as the prompt box has room for; a model may take fewer. */
const MAX_IMAGE_REFERENCES = 5;

export interface PromptInputProps {
  initialConfig?: GenerationConfig;
}

export function PromptInput(props: PromptInputProps) {
  const library = useLibrary();
  const editor = useEditor();
  const { images: selectedImages } = useMediaSelection();
  const { generate } = useGenerate();

  let textareaRef!: HTMLTextAreaElement;
  let dragCounter = 0;
  const [isDragging, setIsDragging] = createSignal(false);

  const [config, setConfig] = createSignal<GenerationConfig>(
    props.initialConfig ?? loadConfig() ?? createDefaultConfig("IMAGE"),
  );

  createEffect(() => saveConfig(config()));

  const credits = useEstimate(config);

  /** Shallow-merge updates into the current config. */
  const patch = (updates: Partial<GenerationConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  };

  const mode = () => config().mode;
  const prompt = () => config().prompt;

  /** The model and the settings it takes: what the prompt box offers. */
  const option = createMemo(() => modelOption(config().model) ?? defaultModelOption(mode()));
  const options = createMemo(() => modelOptions(mode()));
  const modeLabel = () => PROMPT_INPUT_MODE_OPTIONS.find((o) => o.value === mode())?.label.toLowerCase();

  const maxImageReferences = createMemo(() => Math.min(MAX_IMAGE_REFERENCES, option().references ?? 0));

  const aspectRatioOptions = createMemo(() =>
    ASPECT_RATIO_OPTIONS.filter((o) => option().aspectRatios?.includes(o.value)),
  );
  const countOptions = createMemo(() => (option().counts ?? []).map((n) => ({ value: String(n), label: String(n) })));
  const resolutionOptions = createMemo(() =>
    RESOLUTION_OPTIONS.filter((o) => option().resolutions?.includes(o.value)),
  );
  const durations = createMemo(() => durationsAt(option(), config().resolution) ?? []);

  // Pictures on the canvas are offered as references and as video frames:
  // selecting one is another way of attaching it.
  const effectiveImageRefIds = createMemo(() => {
    const lib = library();
    if (!lib) return [];
    const local = config().imageRefIds ?? [];
    const selected = selectedImages()
      .map((entry) => entry.asset.id)
      .filter((id) => !local.includes(id));
    return [...local, ...selected]
      .filter((id) => lib.get(id))
      .slice(0, maxImageReferences());
  });

  /** The library id a frame is set to, explicitly or by the selection. */
  const frameId = (frame: "start" | "end") => {
    // A frame the model cannot take is not one the prompt box offers, and
    // not one a canvas selection quietly attaches either: the declaration is
    // checked against the model before it runs.
    if (!option().frames?.includes(frame)) return null;

    const lib = library();
    const explicit = frame === "start" ? config().startFrameImageId : config().endFrameImageId;
    const id = explicit ?? selectedImages()[frame === "start" ? 0 : 1]?.asset.id ?? null;
    return id && lib?.get(id) ? id : null;
  };

  const effectiveStartFrameId = createMemo(() => frameId("start"));
  const effectiveEndFrameId = createMemo(() => frameId("end"));

  const [recentPrompts, setRecentPrompts] = createStoredSignal(
    store.define<string[]>("prompt-input.recent-prompts", []),
  );
  const [slashMenuDismissed, setSlashMenuDismissed] = createSignal(false);
  const [slashMenuIndex, setSlashMenuIndex] = createSignal(-1);
  const [settingsVisible, setSettingsVisible] = createStoredSignal(
    store.define("prompt-input.settings-visible", false),
  );

  const hasPromptText = () => prompt().trim().length > 0;
  const showSlashMenu = () =>
    prompt().startsWith("/") && !slashMenuDismissed() && recentPrompts().length > 0;

  const handlePromptInput = (event: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
    patch({ prompt: event.currentTarget.value });
    setSlashMenuDismissed(false);
    setSlashMenuIndex(-1);
    resizeTextarea();
  };

  const handleModeChange = (value: string) => {
    const newMode = value as PromptMode;
    if (newMode === mode()) return;
    setConfig(createDefaultConfig(newMode, prompt()));
  };

  const removeImageReference = (assetId: string) => {
    const refs = config().imageRefIds ?? [];
    if (refs.includes(assetId)) {
      patch({ imageRefIds: refs.filter((id) => id !== assetId) });
      return;
    }
    // The reference is shown from a selected canvas entity, so removing it
    // means deselecting that entity.
    const entry = selectedImages().find((e) => e.asset.id === assetId);
    if (entry) editor.deselect(entry.node);
  };

  const openImageReferencesPicker = async () => {
    if (effectiveImageRefIds().length >= maxImageReferences()) return;
    const lib = library();
    if (!lib) return;

    const files = await pickFiles({ accept: "image/*" });
    if (files.length === 0) return;

    // `importFiles` reports its own failures.
    const imported = await importFiles(lib, files, "");
    const imageAssets = imported.filter((a) => a.type === "IMAGE");
    const current = config().imageRefIds ?? [];
    patch({
      imageRefIds: [...current, ...imageAssets.map((a) => a.id)].slice(0, maxImageReferences()),
    });
  };

  const openVideoFramePicker = async (frame: "start" | "end") => {
    const lib = library();
    if (!lib) return;

    const files = await pickFiles({ accept: "image/*", multiple: false });
    if (files.length === 0) return;

    // `importFiles` reports its own failures.
    const [imported] = (await importFiles(lib, files, "")).filter((a) => a.type === "IMAGE");
    if (!imported) return;

    patch(frame === "start" ? { startFrameImageId: imported.id } : { endFrameImageId: imported.id });
  };

  const swapVideoFrameImages = () => {
    const c = config();
    patch({ startFrameImageId: c.endFrameImageId, endFrameImageId: c.startFrameImageId });
  };

  const clearVideoFrame = (frame: "start" | "end") => {
    const explicitId = frame === "start" ? config().startFrameImageId : config().endFrameImageId;
    if (explicitId) {
      patch(frame === "start" ? { startFrameImageId: undefined } : { endFrameImageId: undefined });
      return;
    }
    // The frame is being shown from a selected canvas entity, so clearing it
    // means deselecting that entity (mirrors removeImageReference).
    const entry = selectedImages()[frame === "start" ? 0 : 1];
    if (entry) editor.deselect(entry.node);
  };

  const resizeTextarea = () => {
    textareaRef.style.height = "auto";
    textareaRef.style.height = `${textareaRef.scrollHeight}px`;
  };

  onMount(() => {
    textareaRef.focus();
    textareaRef.setSelectionRange(textareaRef.value.length, textareaRef.value.length);
  });

  const handleSelectRecentPrompt = (prompt: string) => {
    patch({ prompt });
    setSlashMenuDismissed(true);
    resizeTextarea();
  };

  const handleClearHistory = () => {
    setRecentPrompts([]);
  };

  const handleSubmit = async () => {
    if (!hasPromptText()) return;

    const currentConfig = { ...config(), prompt: prompt().trim() };

    // Add to recent prompts
    const filtered = recentPrompts().filter((p) => p !== currentConfig.prompt);
    setRecentPrompts([currentConfig.prompt, ...filtered].slice(0, 10));

    patch({ prompt: "" });
    resizeTextarea();

    // What the model takes of the selection: none of it for a model without
    // references or frames (see `maxImageReferences`, `frameId`).
    generate({
      ...currentConfig,
      imageRefIds: effectiveImageRefIds(),
      startFrameImageId: effectiveStartFrameId() ?? undefined,
      endFrameImageId: effectiveEndFrameId() ?? undefined,
    });
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (showSlashMenu()) {
      const count = recentPrompts().length;
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashMenuIndex((i) => (i <= 0 ? count - 1 : i - 1));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashMenuIndex((i) => (i >= count - 1 ? 0 : i + 1));
      } else if (e.key === "Enter" && slashMenuIndex() >= 0) {
        e.preventDefault();
        handleSelectRecentPrompt(recentPrompts()[slashMenuIndex()]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setSlashMenuDismissed(true);
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleDragEnter = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter++;
    setIsDragging(true);
  };

  const handleDragLeave = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      setIsDragging(false);
    }
  };

  const handleDrop = async (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter = 0;
    setIsDragging(false);

    if (maxImageReferences() === 0 && !option().frames) return;

    const lib = library();
    if (!lib) return;

    // What a generation is given to work from lives in the project library:
    // dragged library assets are taken as they are, external files imported.
    const assetIdData = event.dataTransfer?.getData(ASSET_DRAG_TYPE);
    const existingAssetIds = assetIdData?.split(",").filter(Boolean) ?? [];
    const files = droppedFiles(event).filter((file) => file.type.startsWith("image/"));
    if (existingAssetIds.length === 0 && files.length === 0) return;

    // `importFiles` reports its own failures.
    const droppedIds =
      existingAssetIds.length > 0
        ? existingAssetIds
        : (await importFiles(lib, files, "")).map((a) => a.id);

    const imageIds = droppedIds.filter((id) => lib.get(id)?.type === "IMAGE");
    if (imageIds.length === 0) return;

    if (option().frames) {
      const c = config();
      if (!c.startFrameImageId && imageIds[0]) {
        patch({ startFrameImageId: imageIds[0] });
      }
      if (!c.endFrameImageId && imageIds[1] && option().frames?.includes("end")) {
        patch({ endFrameImageId: imageIds[1] });
      }
      return;
    }

    const current = config().imageRefIds ?? [];
    patch({ imageRefIds: [...current, ...imageIds].slice(0, maxImageReferences()) });
  };

  /** Another model of the mode, the settings carried over where it takes them. */
  const handleModelChange = (id: string) => {
    setConfig(fitToModel({ ...config(), model: id as ModelId }));
  };

  // ── Accessors for UI menus (string ↔ config conversions) ────────────
  const aspectRatioAccessor: Accessor<string> = () => config().aspectRatio ?? "";
  const countAccessor: Accessor<string> = () => String(config().count ?? "");
  const durationAccessor: Accessor<number | undefined> = () => config().duration;
  const resolutionAccessor: Accessor<string> = () => config().resolution ?? "";
  const modelAccessor: Accessor<string> = () => config().model;
  const voiceAccessor: Accessor<string> = () => config().voice ?? "";

  return (
    <div
      class="absolute w-xl max-w-[calc(100%-2rem)] bottom-16 z-10 mx-auto left-1/2 -translate-x-1/2 flex flex-col gap-2 rounded-xl border border-border bg-background p-2"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <PromptInputActions />
      <Switch>
        <Match when={maxImageReferences() > 0}>
          <div class="flex w-full items-start gap-2 overflow-x-auto">
            <For each={effectiveImageRefIds()}>
              {(assetId) => (
                <PromptInputReferenceImageButton
                  asset={library()!.get(assetId)!}
                  cache={library()!.cache}
                  class="size-16"
                  size={{ width: 64, height: 64 }}
                  onRemove={() => removeImageReference(assetId)}
                />
              )}
            </For>
            <Show when={effectiveImageRefIds().length < maxImageReferences()}>
              <PromptInputAttachButton
                icon="attachment"
                label="Image references"
                class="w-36"
                onClick={openImageReferencesPicker}
              />
            </Show>
          </div>
        </Match>

        <Match when={option().frames}>
          <div class="flex w-full items-center gap-2 overflow-x-auto">
            <Show when={option().frames?.includes("start")}>
              <Show
                when={effectiveStartFrameId()}
                fallback={
                  <PromptInputAttachButton
                    icon="image"
                    label="Start frame"
                    class="w-28"
                    onClick={() => openVideoFramePicker("start")}
                  />
                }
              >
                {(src) => (
                  <PromptInputReferenceImageButton
                    asset={library()!.get(src())!}
                    cache={library()!.cache}
                    class="h-16 w-28"
                    size={{ width: 112, height: 64 }}
                    onRemove={() => clearVideoFrame("start")}
                  />
                )}
              </Show>
            </Show>
            <Show when={option().frames?.includes("end")}>
              <Tooltip>
                <TooltipTrigger
                  as={Button}
                  variant="ghost"
                  size="icon-square"
                  class="text-muted-foreground"
                  onClick={swapVideoFrameImages}
                >
                  <Icon name="switch-flip" class="size-6" />
                </TooltipTrigger>
                <TooltipContent>Swap frames</TooltipContent>
              </Tooltip>
              <Show
                when={effectiveEndFrameId()}
                fallback={
                  <PromptInputAttachButton
                    icon="image"
                    label="End frame"
                    class="w-28"
                    onClick={() => openVideoFramePicker("end")}
                  />
                }
              >
                {(src) => (
                  <PromptInputReferenceImageButton
                    asset={library()!.get(src())!}
                    cache={library()!.cache}
                    class="h-16 w-28"
                    size={{ width: 112, height: 64 }}
                    onRemove={() => clearVideoFrame("end")}
                  />
                )}
              </Show>
            </Show>
          </div>
        </Match>
      </Switch>



      <div class="relative flex min-h-14 w-full items-start p-1">
        <Show when={showSlashMenu()}>
          <div class="absolute bottom-full left-0 w-96 max-w-full gap-1 pt-0 text-xs text-muted-foreground flex flex-col rounded-xl border border-border bg-background p-2">
            <div class="flex h-10 items-center justify-between border-b border-border px-1">
              <span class="font-450">Recents</span>
              <button
                type="button"
                class="hover:text-foreground"
                onClick={handleClearHistory}
              >
                Clear history
              </button>
            </div>
            <div class="flex flex-col">
              <For each={recentPrompts()}>
                {(prompt, index) => (
                  <button
                    type="button"
                    class={cx(
                      "flex h-8 w-full items-center rounded-md px-2 text-left hover:bg-input",
                      slashMenuIndex() === index() && "bg-input",
                    )}
                    onClick={() => handleSelectRecentPrompt(prompt)}
                  >
                    <span class="truncate">{prompt}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
        <textarea
          ref={textareaRef}
          class="min-h-8 max-h-32 w-full resize-none overflow-y-auto bg-transparent px-1 py-1 text-xs text-foreground placeholder:text-muted-foreground outline-none"
          placeholder="Describe what you want to create. Type / to open prompt history."
          value={prompt()}
          onInput={handlePromptInput}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div class="flex min-h-4 w-full items-center justify-between">
        <div class="flex min-w-0 items-center gap-1 overflow-x-auto pr-1">
          <PromptInputCompactMenu
            aria-label="Select prompt mode"
            menuLabel="Generate"
            value={() => mode()}
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
            <Show when={options().length > 1}>
              <ModelMenu
                searchPlaceholder={`Search in ${modeLabel()} models`}
                options={options()}
                value={modelAccessor}
                onChange={handleModelChange}
              />
            </Show>
            <Show when={aspectRatioOptions().length > 0}>
              <PromptInputCompactMenu
                aria-label="Select aspect ratio"
                menuLabel="Aspect ratio"
                value={aspectRatioAccessor}
                options={aspectRatioOptions()}
                onChange={(v) => patch({ aspectRatio: v as AspectRatio })}
                triggerIcon="aspect-ratio-16-9"
              />
            </Show>
            <Show when={resolutionOptions().length > 0}>
              <PromptInputCompactMenu
                aria-label="Select resolution"
                menuLabel="Resolution"
                value={resolutionAccessor}
                options={resolutionOptions()}
                onChange={(v) => setConfig(fitToModel({ ...config(), resolution: v as Resolution }))}
                triggerIcon="resolution"
              />
            </Show>
            <Show when={countOptions().length > 0}>
              <PromptInputCompactMenu
                aria-label="Select amount of variants"
                menuLabel="Amount of variants"
                value={countAccessor}
                options={countOptions()}
                onChange={(v) => patch({ count: Number(v) })}
                triggerIcon="variants"
              />
            </Show>
            <Show when={durations().length > 0}>
              <DurationMenu
                durations={durations()}
                value={durationAccessor}
                onChange={(duration) => patch({ duration })}
              />
            </Show>
            <Show when={option().durationRange}>
              {(range) => (
                <DurationRangeMenu
                  range={range()}
                  value={durationAccessor}
                  onChange={(duration) => patch({ duration })}
                />
              )}
            </Show>
            <Show when={option().voices}>
              {(voices) => <VoiceMenu options={voices()} value={voiceAccessor} onChange={(v) => patch({ voice: v })} />}
            </Show>
          </Show>
        </div>
        <Tooltip>
          <TooltipTrigger
            as={Button}
            variant="default"
            size="icon-square"
            disabled={!hasPromptText()}
            onClick={handleSubmit}
          >
            <Icon name="arrow-right" class="-rotate-90 size-6" />
          </TooltipTrigger>
          <TooltipContent class="flex-col items-stretch px-2 pt-0.5 pb-2">
            <div class="flex h-7 items-center gap-2">
              <span class="flex-1 truncate">Generate</span>
              <span class="min-w-5 text-right text-xxs font-normal text-muted-foreground">↩︎</span>
            </div>
            <Show when={credits() !== undefined}>
              <span class="font-normal text-muted-foreground">
                This will cost {credits()!.toLocaleString()} {credits() === 1 ? "credit" : "credits"}
              </span>
            </Show>
          </TooltipContent>
        </Tooltip>
      </div>
      <Show when={isDragging()}>
        <div class="absolute inset-0 z-20 rounded-xl bg-background border border-primary p-2 overflow-hidden">
          <div class="absolute inset-0 bg-accent/40 rounded-xl" />
          <div class="flex size-full items-center justify-center rounded-md border border-dashed border-border-input">
            <Icon name="attachment" class="size-6 text-muted-foreground" />
            <span class="text-xs font-450 text-muted-foreground">Drop images here</span>
          </div>
        </div>
      </Show>
    </div>
  );
}


type PromptInputCompactMenuProps = {
  menuLabel: string;
  value: Accessor<string>;
  options: { value: string; label: string; triggerLabel?: string; icon?: string }[];
  onChange: (value: string) => void;
  triggerIcon?: string;
  /** The trigger's label, for a value none of the options has. */
  label?: string;
  open?: boolean;
  onOpenChange?(open: boolean): void;
  /** Below the options. */
  children?: JSX.Element;
}

function PromptInputCompactMenu(props: PromptInputCompactMenuProps) {
  const selectedOption = () =>
    props.options.find((option) => option.value === props.value()) ?? props.options[0];
  const selectedIcon = () => selectedOption()?.icon ?? props.triggerIcon ?? "chevron-down";
  const selectedLabel = () => props.label ?? selectedOption()?.triggerLabel ?? selectedOption()?.label ?? "";

  return (
    <DropdownMenu placement="top-start" open={props.open} onOpenChange={props.onOpenChange}>
      <DropdownMenuTrigger<typeof Button>
        as={(triggerProps) => (
          <Button
            {...triggerProps}
            variant="ghost"
            class={DEFAULT_BUTTON_CLASS}
          >
            <Icon name={selectedIcon()} class="size-6" />
            {selectedLabel()}
          </Button>
        )}
      />
      <DropdownMenuPortal>
        <DropdownMenuContent class="w-40 gap-0 p-2">
          <div class="flex h-8 items-center px-1 text-xs text-muted-foreground">
            {props.menuLabel}
          </div>
          <DropdownMenuGroup>
            <For each={props.options}>
              {(option) => {
                const selected = () => props.value() === option.value;

                return (
                  <DropdownMenuItem
                    tone="neutral"
                    class="h-8 px-0 data-highlighted:bg-input"
                    onSelect={() => props.onChange(option.value)}
                  >
                    <Show when={option.icon}>
                      {(icon) => (
                        <span class="grid h-7 w-7 shrink-0 place-items-center overflow-clip">
                          <Icon name={icon()} class="size-6 text-muted-foreground" />
                        </span>
                      )}
                    </Show>
                    <span
                      class={cx(
                        "min-w-0 flex-1 truncate",
                        selected() ? "text-foreground" : "text-muted-foreground",
                        !option.icon && "pl-2",
                      )}
                    >
                      {option.label}
                    </span>
                    <span class="grid h-7 w-7 shrink-0 place-items-center overflow-clip">
                      <Show when={selected()}>
                        <Icon name="confirm-check" class="size-6 text-foreground" />
                      </Show>
                    </span>
                  </DropdownMenuItem>
                );
              }}
            </For>
          </DropdownMenuGroup>
          {props.children}
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}

/** The greatest common divisor of the gaps between `durations`: the slider's step. */
const durationStep = (durations: number[]) => {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  return durations.slice(1).reduce((step, d, i) => gcd(step, d - durations[i]), 0) || 1;
};

/** The index of the duration nearest to `seconds`. */
const nearestDurationIndex = (durations: number[], seconds: number) =>
  durations.reduce((best, d, i) => (Math.abs(d - seconds) < Math.abs(durations[best] - seconds) ? i : best), 0);

type DurationMenuProps = {
  durations: number[];
  value: Accessor<number | undefined>;
  onChange(value: number): void;
}

/**
 * The duration picker: a slider over the lengths the model takes, snapping to
 * them where they have gaps.
 */
function DurationMenu(props: DurationMenuProps) {
  const min = () => props.durations[0];
  const max = () => props.durations[props.durations.length - 1];
  const index = () => nearestDurationIndex(props.durations, props.value() ?? min());
  const value = () => props.durations[index()];
  const fixed = () => min() === max();

  const select = (seconds: number) => {
    const next = props.durations[nearestDurationIndex(props.durations, seconds)];
    if (next !== props.value()) props.onChange(next);
  };

  return (
    <Popover placement="top-start">
      <PopoverTrigger<typeof Button>
        aria-label="Select duration"
        as={(triggerProps) => (
          <Button
            {...triggerProps}
            variant="ghost"
            class={DEFAULT_BUTTON_CLASS}
          >
            <Icon name="duration" class="size-6" />
            {`${value()}s`}
          </Button>
        )}
      />
      <PopoverPortal>
        <PopoverContent class="flex w-56 flex-col gap-1 px-3 pt-0 pb-3 rounded-xl">
          <div class="flex h-8 items-center justify-between text-xs">
            <span class="text-muted-foreground">Duration</span>
            <span class="text-foreground">{`${value()}s`}</span>
          </div>
          <Slider
            aria-label="Duration"
            value={[value()]}
            // A slider over no range divides by zero: one length shows full.
            minValue={fixed() ? min() - 1 : min()}
            maxValue={max()}
            step={durationStep(props.durations)}
            disabled={fixed()}
            getValueLabel={({ values }) => `${values[0]} seconds`}
            onChange={([seconds]) => select(seconds)}
          >
            <SliderTrack>
              <SliderFill />
              <SliderThumb />
            </SliderTrack>
          </Slider>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

/** `seconds` the way a menu lists it: 45s, 2m, 1m 30s. */
const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (!minutes) return `${rest}s`;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
};

/** `seconds` as a clock: 01:30. */
const formatClock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

/** The seconds a typed duration names (1:30, 1m 30s, 90s, 90); undefined for anything else. */
const parseDuration = (text: string) => {
  const input = text.trim().toLowerCase();
  const clock = /^(\d+):(\d{1,2})$/.exec(input);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const units = /^(?:(\d+)\s*m)?\s*(?:(\d+)\s*s?)?$/.exec(input);
  if (!units || (units[1] === undefined && units[2] === undefined)) return undefined;
  return Number(units[1] ?? 0) * 60 + Number(units[2] ?? 0);
};

type DurationRangeMenuProps = {
  range: { min: number; max: number; default: number; presets: number[] };
  value: Accessor<number | undefined>;
  onChange(value: number): void;
}

/**
 * The duration picker of a model taking any length within a range: a few
 * presets, and a custom length typed as a clock.
 */
function DurationRangeMenu(props: DurationRangeMenuProps) {
  const [open, setOpen] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  /** What is typed into the custom field; undefined while nothing is. */
  const [draft, setDraft] = createSignal<string>();

  const value = () => props.value() ?? props.range.default;
  const isCustom = () => !props.range.presets.includes(value());
  const options = () =>
    props.range.presets.map((seconds) => ({ value: String(seconds), label: formatDuration(seconds) }));

  /** Applies the typed length, within the range; false when nothing valid is typed. */
  const commit = () => {
    const seconds = parseDuration(draft() ?? "");
    setDraft(undefined);
    if (!seconds) return false;
    const next = Math.max(props.range.min, Math.min(props.range.max, seconds));
    if (next !== value()) props.onChange(next);
    return true;
  };

  const handleOpenChange = (next: boolean) => {
    // Closing by a click outside keeps what was typed; Escape has dropped it already.
    if (!next && draft() !== undefined) commit();
    setOpen(next);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setDraft(undefined);
      return;
    }
    // The menu would take the keys as typeahead and arrow navigation.
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      if (commit()) setOpen(false);
    }
  };

  return (
    <PromptInputCompactMenu
      menuLabel="Duration"
      // While a custom length is typed, it is the one being picked: no row is checked.
      value={() => (isCustom() || focused() ? "" : String(value()))}
      options={options()}
      onChange={(v) => props.onChange(Number(v))}
      triggerIcon="duration"
      label={formatDuration(value())}
      open={open()}
      onOpenChange={handleOpenChange}
    >
      {/* The menu's rows sit flush; the design spaces the custom field off them. */}
      <Separator class="my-2" />
      <div
        class={cx(
          "flex h-7 items-center rounded-md pl-2 text-xs",
          focused() ? "bg-input ring-1 ring-inset ring-ring" : isCustom() ? "bg-muted" : "bg-input",
        )}
      >
        <input
          type="text"
          aria-label="Custom duration"
          placeholder="Custom duration"
          class="h-full min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
          value={draft() ?? (isCustom() ? formatClock(value()) : "")}
          onFocus={(e) => {
            setFocused(true);
            setDraft(e.currentTarget.value);
            e.currentTarget.select();
          }}
          onBlur={() => setFocused(false)}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
        />
        <Show when={focused() || isCustom()}>
          <button
            type="button"
            aria-label="Use custom duration"
            class="grid h-7 w-6 shrink-0 place-items-center"
            // Keeps the field focused, so its draft is still there to apply.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (draft() !== undefined && commit()) setOpen(false);
            }}
          >
            <Icon name="confirm-check" class="size-6 text-foreground" />
          </button>
        </Show>
      </div>
    </PromptInputCompactMenu>
  );
}

type ModelMenuProps = {
  searchPlaceholder: string;
  options: { id: string; name: string; description: string; icon: string }[];
  value: Accessor<string>;
  onChange(value: string): void;
}

/**
 * A list picked from with the keyboard while its search keeps focus: the
 * arrow keys move the highlight, Enter picks the highlighted item, and the
 * pointer highlights what it moves over.
 */
function createListNavigation<T>(items: Accessor<T[]>, pick: (item: T) => void) {
  const [active, setActive] = createSignal(0);
  let list: HTMLElement | undefined;

  const highlight = (index: number) => {
    setActive(index);
    list?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const count = items().length;
    if (!count) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      highlight((active() + (e.key === "ArrowDown" ? 1 : -1) + count) % count);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items()[active()];
      if (item) pick(item);
    }
  };

  return {
    active,
    highlight,
    onKeyDown,
    listProps: {
      ref: (el: HTMLElement) => (list = el),
      // A click on a row keeps the focus in the search, so the keys keep working.
      onMouseDown: (e: MouseEvent) => {
        if (e.target !== e.currentTarget) e.preventDefault();
      },
    },
    rowProps: (index: Accessor<number>) => ({
      "data-index": index(),
      onPointerMove: () => setActive(index()),
    }),
  };
}

function ModelMenu(props: ModelMenuProps) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  let search: HTMLInputElement | undefined;

  /** The options matching the query, in their order of relevance: a name starting with it first, then one containing it, then a description containing it. */
  const filteredOptions = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return props.options;
    const rank = (o: ModelMenuProps["options"][number]) => {
      const name = o.name.toLowerCase();
      if (name.startsWith(q)) return 0;
      if (name.includes(q)) return 1;
      if (o.description.toLowerCase().includes(q)) return 2;
      return -1;
    };
    return props.options
      .map((option) => ({ option, rank: rank(option) }))
      .filter((o) => o.rank >= 0)
      .sort((a, b) => a.rank - b.rank)
      .map((o) => o.option);
  });

  const selectModel = (id: string) => {
    props.onChange(id);
    setOpen(false);
  };

  const nav = createListNavigation(filteredOptions, (option) => selectModel(option.id));

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) setQuery("");
  };

  const icon = createMemo(() => {
    const option = props.options.find((o) => o.id === props.value());
    return option?.icon ?? props.options[0].icon;
  });

  const name = createMemo(() => {
    const option = props.options.find((o) => o.id === props.value());
    return option?.name ?? props.options[0].name;
  });

  const handleAutoFocus = (e: Event) => {
    e.preventDefault();
    search?.focus();
    // Kobalte calls this inside its focus scope's effect: a signal read here
    // would rerun the effect on every keystroke and hand focus to the trigger.
    untrack(() => nav.highlight(Math.max(0, filteredOptions().findIndex((o) => o.id === props.value()))));
  };

  return (
    <Popover placement="top-start" open={open()} onOpenChange={handleOpenChange}>
      <PopoverTrigger<typeof Button>
        as={(triggerProps) => (
          <Button
            {...triggerProps}
            variant="ghost"
            class={DEFAULT_BUTTON_CLASS}
          >
            <Icon name={icon()} class="size-6" />
            {name()}
          </Button>
        )}
      />
      <PopoverPortal>
        <PopoverContent
          class="w-[340px] p-0 rounded-xl"
          onOpenAutoFocus={handleAutoFocus}
        >
          <SearchInput
            ref={(el) => (search = el)}
            placeholder={props.searchPlaceholder}
            value={query()}
            onValue={(value) => {
              setQuery(value);
              nav.highlight(0);
            }}
            onKeyDown={nav.onKeyDown}
          />
          {/* Six rows tall: 6 × 42px rows, 5 × 8px gaps, 2 × 4px padding. */}
          <div class="flex flex-col gap-2 px-2 py-1 max-h-[300px] overflow-y-auto" {...nav.listProps}>
            <For each={filteredOptions()}>
              {(option, index) => {
                const selected = () => props.value() === option.id;
                const active = () => nav.active() === index();

                return (
                  <button
                    type="button"
                    tabIndex={-1}
                    class="flex h-[42px] w-full shrink-0 items-center gap-2 rounded-md px-1 py-1 text-left text-xs"
                    classList={{
                      "bg-input": active() && !selected(),
                      "bg-muted": active() && selected(),
                    }}
                    onClick={() => selectModel(option.id)}
                    {...nav.rowProps(index)}
                  >
                    <div class="grid size-8 shrink-0 place-items-center overflow-hidden rounded-sm" >
                      <Icon name={option.icon!} class="size-6 text-muted-foreground" />
                    </div>
                    <div class="min-w-0 flex-1 text-muted-foreground">
                      <div class="truncate font-450" classList={{ "text-foreground": active() || selected() }}>{option.name}</div>
                      <div class="truncate">{option.description}</div>
                    </div>
                    <span class="grid size-7 place-items-center">
                      <Show when={selected()}>
                        <Icon name="confirm-check" class="size-6 text-foreground" />
                      </Show>
                    </span>
                  </button>
                )
              }}
            </For>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

type VoiceMenuProps = {
  options: { value: string; label: string; thumbnail: string; description: string; previewUrl: string }[];
  value: Accessor<string>;
  onChange(value: string): void;
}

function VoiceMenu(props: VoiceMenuProps) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [playingVoice, setPlayingVoice] = createSignal<string | null>(null);

  let audioRef: HTMLAudioElement | undefined;
  let search: HTMLInputElement | undefined;

  const selectedLabel = () =>
    props.options.find((o) => o.value === props.value())?.label ?? props.value();

  const filteredOptions = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return props.options;
    return props.options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.description.toLowerCase().includes(q),
    );
  });

  const stopPlayback = () => {
    if (audioRef) {
      audioRef.pause();
      audioRef.src = "";
      audioRef = undefined;
    }
    setPlayingVoice(null);
  };

  const togglePreview = (voiceId: string) => {
    if (playingVoice() === voiceId) {
      stopPlayback();
      return;
    }

    stopPlayback();
    const url = props.options.find((o) => o.value === voiceId)?.previewUrl;
    if (!url) return;

    audioRef = new Audio(url);
    audioRef.addEventListener("ended", () => setPlayingVoice(null));
    audioRef.play();
    setPlayingVoice(voiceId);
  };

  const selectVoice = (voiceId: string) => {
    props.onChange(voiceId);
    setOpen(false);
  };

  const nav = createListNavigation(filteredOptions, (option) => selectVoice(option.value));

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setQuery("");
      stopPlayback();
    }
  };

  onCleanup(stopPlayback);

  const handleAutoFocus = (e: Event) => {
    e.preventDefault();
    search?.focus();
    // Kobalte calls this inside its focus scope's effect: a signal read here
    // would rerun the effect on every keystroke and hand focus to the trigger.
    untrack(() => nav.highlight(Math.max(0, filteredOptions().findIndex((o) => o.value === props.value()))));
  };

  return (
    <Popover placement="top-start" open={open()} onOpenChange={handleOpenChange}>
      <PopoverTrigger<typeof Button>
        as={(triggerProps) => (
          <Button
            {...triggerProps}
            variant="ghost"
            class={DEFAULT_BUTTON_CLASS}
          >
            <Icon name="user" class="size-6" />
            {selectedLabel()}
          </Button>
        )}
      />
      <PopoverPortal>
        <PopoverContent
          class="w-[340px] p-0 rounded-xl"
          onOpenAutoFocus={handleAutoFocus}
        >
          <SearchInput
            ref={(el) => (search = el)}
            placeholder="Search in voices"
            value={query()}
            onValue={(value) => {
              setQuery(value);
              nav.highlight(0);
            }}
            onKeyDown={nav.onKeyDown}
          />
          {/* Six rows tall: 6 × 42px rows, 5 × 8px gaps, 2 × 8px padding. */}
          <div class="flex flex-col gap-2 p-2 max-h-[308px] overflow-y-auto" {...nav.listProps}>
            <For each={filteredOptions()}>
              {(option, index) => {
                const selected = () => props.value() === option.value;
                const active = () => nav.active() === index();
                const isPlaying = () => playingVoice() === option.value;

                return (
                  <button
                    type="button"
                    tabIndex={-1}
                    class="flex shrink-0 items-center gap-2 rounded-md px-1 py-1 h-[42px] w-full text-left transition-colors"
                    classList={{ "bg-accent": active() && !selected(), "bg-muted": selected() }}
                    onClick={() => selectVoice(option.value)}
                    {...nav.rowProps(index)}
                  >
                    <div
                      class="group/thumb relative grid size-8 rounded-full overflow-hidden shrink-0 place-items-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePreview(option.value);
                      }}
                    >
                      <img src={option.thumbnail} alt={option.label} class="w-full h-full object-cover" />
                      <div
                        class="absolute inset-0 grid place-items-center rounded-full bg-black/0 transition-colors group-hover/thumb:bg-black/60"
                        classList={{ "bg-black/60": isPlaying() }}
                      >
                        <Icon
                          name={isPlaying() ? "pause" : "play"}
                          class={cx("size-6 text-white transition-opacity group-hover/thumb:opacity-100", isPlaying() ? "opacity-100" : "opacity-0")}
                        />
                      </div>
                    </div>
                    <div class="min-w-0 flex-1 text-muted-foreground">
                      <div
                        class="truncate text-base font-450"
                        classList={{ "text-foreground": active() || selected() }}
                      >
                        {option.label}
                      </div>
                      <div class="truncate text-base">{option.description}</div>
                    </div>
                    <span class="grid size-7 place-items-center shrink-0">
                      <Show when={selected()}>
                        <Icon name="confirm-check" class="size-6 text-foreground" />
                      </Show>
                    </span>
                  </button>
                )
              }}
            </For>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

type PromptInputReferenceImageButtonProps = {
  asset: ThumbnailAsset;
  cache?: AssetCache;
  class?: string;
  size?: { width: number; height: number };
  onRemove(): void;
}

function PromptInputReferenceImageButton(props: PromptInputReferenceImageButtonProps) {
  return (
    <div class={cx("group relative shrink-0", props.class)}>
      <div class="size-full overflow-hidden rounded-md bg-input outline-none">
        <AssetThumbnail asset={props.asset} cache={props.cache} class="size-full" size={props.size} />
      </div>
      <Show when={props.onRemove}>
        <RemoveButton
          label="Remove reference"
          class="absolute right-1.5 top-1.5 z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          onClick={props.onRemove}
        />
      </Show>
    </div>
  );
}

type PromptInputAttachButtonProps = {
  icon: string;
  label: string;
  class?: string;
  onClick(): void;
}

export function PromptInputAttachButton(props: PromptInputAttachButtonProps) {
  return (
    <button
      type="button"
      class={cx(
        "flex h-16 shrink-0 items-center justify-center gap-1 overflow-clip rounded-md bg-secondary active:bg-secondary-pressing pl-3 pr-4 py-2 text-muted-foreground transition-colors hover:bg-muted",
        props.class,
      )}
      onClick={props.onClick}
    >
      <Icon name={props.icon} class="size-6" />
      <span class="whitespace-nowrap text-xs">
        {props.label}
      </span>
    </button>
  );
}
