/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createResource, createSignal, onMount, splitProps } from "solid-js";
import { Portal } from "solid-js/web";
import { SAM2_MODELS, downloadSize, sam2Model } from "@diffusionstudio/sam2/models";
import { useWorld } from "@diffusionstudio/koota-solid";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Separator } from "@/components/ui/separator";
import { SegmentedIconTabs } from "@/components/ui/segmented-icon-tabs";
import { SliderInput } from "@/components/ui/slider-input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cx } from "@/lib/cva";
import { useDerived } from "@/engine/hooks";
import {
  brushRadius,
  cancelObjectMask,
  getMaskRestore,
  getObjectTrack,
  heldObjectMaskOp,
  objectMaskMode,
  objectMaskModel,
  objectMaskModelLoad,
  objectMaskOp,
  pickObjectMaskModel,
  preloadObjectMaskModel,
  setBrushRadius,
  setObjectMaskMode,
  setObjectMaskOp,
  trackObjectMask,
} from "@/engine/object-mask";

import type { JSX } from "solid-js";
import type { Sam2Model, Sam2ModelId } from "@diffusionstudio/sam2/models";
import type { ObjectMaskMode, ObjectMaskModelLoad, ObjectMaskOp, ObjectTrackStatus } from "@/engine/object-mask";

const MODES = [
  { value: "points", label: "Point", icon: "object-mask.point", shortcut: "P" },
  { value: "brush", label: "Brush", icon: "mask-small", shortcut: "B" },
] as const satisfies readonly { value: ObjectMaskMode; label: string; icon: string; shortcut: string }[];

/** The popover's segments: labels only, the icons are the trigger's. */
const MODE_TABS = MODES.map(({ value, label }) => ({ value, label }));

const OPS = [
  { value: "add", label: "Add", icon: "object-mask.add", hint: "Add to object" },
  { value: "subtract", label: "Subtract", icon: "object-mask.subtract", hint: "Subtract from object" },
] as const satisfies readonly { value: ObjectMaskOp; label: string; icon: string; hint: string }[];

/** When to reach for each model: tiny runs at half resolution, the others at the full 1024. */
const MODEL_NOTES: Record<Sam2ModelId, string> = {
  tiny: "Use for quick masks of large, clear subjects. Fastest, at half resolution.",
  small: "Use when Tiny's edges are too rough.",
  "base-plus": "Use for small or thin objects that Small loses.",
  large: "Use for hard shots, when accuracy matters more than speed.",
};

/** The brush's size on its slider: its diameter, in percent of the frame's height. */
const BRUSH_SIZE = { min: 1, max: 30 };

/** The menus the bar opens: headed lists, laid out like the toolbar's own. */
const MENU_CLASS = "rounded-xl border-border bg-background px-2 pt-0 pb-2 gap-0 shadow-[0px_12px_24px_0px_rgba(0,0,0,0.24)]";

type SessionState = {
  status: ObjectTrackStatus | null;
  completed: number;
  total: number;
};

/**
 * The object mask tool's action bar, over the canvas while the tool is up:
 * the model, how clicks prompt (points or the brush, adding to the object or
 * subtracting from it), and the way out — Cancel drops the prompt, Confirm
 * tracks the picked object through its clip and writes the mask into the
 * document.
 */
export function ObjectMaskBar() {
  const world = useWorld();

  // The model is fetched as the tool opens, so it is ready by the first click.
  onMount(preloadObjectMaskModel);

  const state = useDerived<SessionState | null>(() => {
    const track = getObjectTrack();
    if (!track) return null;
    return { status: track.status, completed: track.completed, total: track.masks.length };
  }, sameState);

  const busy = () => {
    const status = state()?.status;
    return status === "loading" || status === "segmenting" || status === "tracking" || status === "saving";
  };

  const confirmLabel = () => {
    const session = state();
    switch (session?.status) {
      case "tracking":
        return (
          <FixedWidth widest="Tracking 100%">
            {`Tracking ${percent(session.total === 0 ? 0 : session.completed / session.total)}`}
          </FixedWidth>
        );
      case "saving":
        return "Saving...";
      default:
        return "Confirm";
    }
  };

  return (
    <div class="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 rounded-xl px-1.5 py-1 bg-background border border-border flex gap-1 items-center">
      <ModelMenu disabled={busy()} />
      <Separator orientation="vertical" class="min-h-5" />
      <ModePopover />
      <OpMenu />
      <Separator orientation="vertical" class="min-h-5" />
      <Tooltip>
        <TooltipTrigger as={Button} variant="ghost" class="text-muted-foreground" onClick={() => cancelObjectMask(world)}>
          Cancel
        </TooltipTrigger>
        <TooltipContent shortcut="Esc">Cancel</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as={Button} disabled={state()?.status !== "seeded"} onClick={() => trackObjectMask(world)}>
          {confirmLabel()}
        </TooltipTrigger>
        <TooltipContent shortcut="⌘↵"></TooltipContent>
      </Tooltip>
    </div>
  );
}

/**
 * The model the tool segments with. Hovering a model shows, to the left of
 * its row, when to use it and what it costs to fetch.
 */
function ModelMenu(props: { disabled: boolean }) {
  // The chosen model's load, while it is under way or failed.
  const load = () => {
    const current = objectMaskModelLoad();
    return current && current.id === objectMaskModel() && current.phase !== "ready" ? current : null;
  };
  // A restore holds the model too: switching would take it away mid-way.
  const restoring = useDerived(() => getMaskRestore() !== null);

  // Which models are on this machine already, looked at again as loads finish.
  const [cached] = createResource(
    () => objectMaskModelLoad()?.phase ?? "idle",
    async () => (await import("@diffusionstudio/sam2")).cachedSam2Models(),
  );
  // The row under the pointer (or keyboard), whose hint shows beside it.
  const [hovered, setHovered] = createSignal<{ model: Sam2Model; row: HTMLElement } | null>(null);
  const sizeNote = (model: Sam2Model) =>
    `${formatSize(downloadSize(model))}${cached()?.has(model.id) ? ", downloaded" : " download"}`;

  return (
    <DropdownMenu placement="top-start" gutter={8} onOpenChange={(open) => !open && setHovered(null)}>
      <Tooltip>
        <TooltipTrigger<typeof DropdownMenuTrigger>
          as={(triggerProps: object) => (
            <DropdownMenuTrigger<typeof Button>
              {...triggerProps}
              disabled={props.disabled || restoring()}
              as={(buttonProps) => (
                <Button
                  {...buttonProps}
                  variant="ghost"
                  class={cx("gap-1", load()?.phase === "error" ? "gap-0 pl-0.5 text-destructive" : "text-muted-foreground")}
                >
                  <Show when={load()?.phase === "error"}>
                    <Icon name="alert-warning" />
                  </Show>
                  <Show
                    when={load()?.phase === "download" || load()?.phase === "compile"}
                    fallback={sam2Model(objectMaskModel()).label}
                  >
                    <FixedWidth widest={<ModelProgress label={sam2Model(objectMaskModel()).label} percent="100%" />}>
                      <ModelProgress
                        label={sam2Model(objectMaskModel()).label}
                        percent={percent(load()!.phase === "download" ? load()!.progress : null)}
                      />
                    </FixedWidth>
                  </Show>
                </Button>
              )}
            />
          )}
        />
        <TooltipContent>{load() ? describeModelLoad(load()!) : "Segmentation model"}</TooltipContent>
      </Tooltip>
      <DropdownMenuPortal>
        <DropdownMenuContent class={cx(MENU_CLASS, "min-w-40")} onEscapeKeyDown={keepEscape}>
          <MenuHeader>Model</MenuHeader>
          <div class="flex flex-col gap-1 py-0.5">
            <For each={SAM2_MODELS}>
              {(model) => (
                <CheckedItem
                  checked={model.id === objectMaskModel()}
                  onSelect={() => pickObjectMaskModel(model.id)}
                  onHover={(row) => setHovered(row ? { model, row } : null)}
                >
                  {model.label}
                </CheckedItem>
              )}
            </For>
          </div>
        </DropdownMenuContent>
      </DropdownMenuPortal>
      <Show when={hovered()}>
        {(hover) => (
          <Portal>
            <ModelHint row={hover().row}>
              <span>{MODEL_NOTES[hover().model.id]}</span>
              <span class="text-muted-foreground">{sizeNote(hover().model)}</span>
            </ModelHint>
          </Portal>
        )}
      </Show>
    </DropdownMenu>
  );
}

/** A tooltip-like note 12px to the left of `row`, centered on it. */
function ModelHint(props: { row: HTMLElement; children: JSX.Element }) {
  const rect = () => props.row.getBoundingClientRect();

  return (
    <div
      role="tooltip"
      class="pointer-events-none fixed z-[10001] flex max-w-56 -translate-x-full -translate-y-1/2 flex-col gap-0.5 rounded-md border border-border bg-background px-2 py-1 text-xs font-450 text-foreground shadow-md"
      style={{ left: `${rect().left - 12}px`, top: `${rect().top + rect().height / 2}px` }}
    >
      {props.children}
    </div>
  );
}

/** Points or the brush, and the brush's size. */
function ModePopover() {
  const mode = () => MODES.find((entry) => entry.value === objectMaskMode()) ?? MODES[0];

  return (
    <Popover placement="top-start" gutter={8}>
      <Tooltip>
        <TooltipTrigger<typeof PopoverTrigger>
          as={(triggerProps: object) => (
            <PopoverTrigger<typeof Button>
              {...triggerProps}
              as={(buttonProps) => (
                <Button {...buttonProps} variant="ghost" class="gap-0 pl-0.5 text-muted-foreground">
                  <Icon name={mode().icon} />
                  {mode().label}
                </Button>
              )}
            />
          )}
        />
        <TooltipContent shortcut={mode().shortcut}>{mode().label}</TooltipContent>
      </Tooltip>
      <PopoverPortal>
        <PopoverContent
          class={cx(MENU_CLASS, "w-44")}
          onEscapeKeyDown={keepEscape}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <MenuHeader>Tool</MenuHeader>
          <SegmentedIconTabs value={objectMaskMode} onChange={setObjectMaskMode} items={MODE_TABS} class="my-0.5" />
          <Show when={objectMaskMode() === "brush"}>
            <div class="pt-2 pb-0.5">
              <SliderInput
                value={Math.round(brushRadius() * 200)}
                min={BRUSH_SIZE.min}
                max={BRUSH_SIZE.max}
                onChange={(value) => setBrushRadius(Math.min(BRUSH_SIZE.max, Math.max(BRUSH_SIZE.min, value)) / 200)}
                format={(value) => `${value}%`}
              />
            </div>
          </Show>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

/** Whether clicks add to the object or subtract from it; the button shows the op alt swaps in while held. */
function OpMenu() {
  const world = useWorld();
  const held = useDerived(() => heldObjectMaskOp(world));
  const op = () => OPS.find((entry) => entry.value === held()) ?? OPS[0];

  return (
    <DropdownMenu placement="top-start" gutter={8}>
      <Tooltip>
        <TooltipTrigger<typeof DropdownMenuTrigger>
          as={(triggerProps: object) => (
            <DropdownMenuTrigger<typeof Button>
              {...triggerProps}
              as={(buttonProps) => (
                <Button {...buttonProps} variant="ghost" class="gap-0 pl-0.5 text-muted-foreground">
                  <Icon name={op().icon} />
                  {op().label}
                </Button>
              )}
            />
          )}
        />
        <TooltipContent shortcut="Hold ⌥ to swap">{op().hint}</TooltipContent>
      </Tooltip>
      <DropdownMenuPortal>
        <DropdownMenuContent class={cx(MENU_CLASS, "min-w-40")} onEscapeKeyDown={keepEscape}>
          <MenuHeader>Mode</MenuHeader>
          <div class="flex flex-col gap-1 py-0.5">
            <For each={OPS}>
              {(entry) => (
                <CheckedItem checked={entry.value === objectMaskOp()} onSelect={() => setObjectMaskOp(entry.value)}>
                  {entry.label}
                </CheckedItem>
              )}
            </For>
          </div>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}

function MenuHeader(props: { children: JSX.Element }) {
  return <div class="flex h-8 items-center px-1 text-xs text-muted-foreground">{props.children}</div>;
}

type CheckedItemProps = {
  checked: boolean;
  onSelect(): void;
  onHover?(row: HTMLElement | null): void;
  children: JSX.Element;
};

/** A menu row that is the current pick: raised, with a check at its end. */
function CheckedItem(props: CheckedItemProps) {
  const [local, rest] = splitProps(props, ["checked", "onHover", "children"]);

  return (
    <DropdownMenuItem
      {...rest}
      onPointerEnter={(event: PointerEvent) => local.onHover?.(event.currentTarget as HTMLElement)}
      onPointerLeave={() => local.onHover?.(null)}
      onFocus={(event: FocusEvent) => local.onHover?.(event.currentTarget as HTMLElement)}
      onBlur={() => local.onHover?.(null)}
      tone="neutral"
      class={cx("pr-0", local.checked ? "bg-accent text-foreground" : "text-muted-foreground")}
    >
      <span class="min-w-0 flex-1 truncate">{local.children}</span>
      <span class="flex size-7 items-center justify-center">
        <Show when={local.checked}>
          <Icon name="confirm-check" class="text-foreground" />
        </Show>
      </span>
    </DropdownMenuItem>
  );
}

/** Esc closes an open menu; it goes no further, where it would put the tool down. */
function keepEscape(event: KeyboardEvent) {
  event.stopPropagation();
}

/**
 * Content as wide as `widest` whatever it says, centered in that width: the
 * button around it holds still as a number in it counts up.
 */
function FixedWidth(props: { widest: JSX.Element; children: JSX.Element }) {
  return (
    <span class="inline-grid tabular-nums">
      <span class="invisible col-start-1 row-start-1 flex items-center justify-center gap-1" aria-hidden="true">
        {props.widest}
      </span>
      <span class="col-start-1 row-start-1 flex items-center justify-center gap-1">{props.children}</span>
    </span>
  );
}

/** The model's name with its download's progress after it. */
function ModelProgress(props: { label: string; percent: string }) {
  return (
    <>
      {props.label}
      <span class="text-xxs font-normal">{props.percent}</span>
    </>
  );
}

/** 0 to 1 as a whole percentage; null, while there is no number yet, as an ellipsis. */
function percent(value: number | null): string {
  return value === null ? "" : `${Math.floor(value * 100)}%`;
}

function describeModelLoad(load: ObjectMaskModelLoad): string {
  const label = sam2Model(load.id).label;
  switch (load.phase) {
    case "download":
      return load.progress === null ? `Downloading ${label}...` : `Downloading ${label}, ${Math.floor(load.progress * 100)}%`;
    case "compile":
      return `Preparing ${label}...`;
    case "error":
      return `${load.error ?? `${label} could not be loaded`}. Pick it again to retry.`;
    default:
      return "";
  }
}

function formatSize(bytes: number): string {
  return `${Math.round(bytes / 1e6)} MB`;
}

function sameState(a: SessionState | null, b: SessionState | null): boolean {
  if (a === null || b === null) return a === b;
  return a.status === b.status && a.completed === b.completed && a.total === b.total;
}
