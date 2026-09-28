/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createResource, onMount } from "solid-js";
import { SAM2_MODELS, downloadSize, sam2Model } from "@diffusionstudio/sam2/models";
import { DEFAULT_MASK_SMOOTHING, assetName } from "@diffusionstudio/assets";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ControlRow } from "@/components/ui/control-group";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorSeparator,
} from "@/components/ui/floating-inspector";
import { Icon } from "@/components/ui/icon";
import { IncrementDecrementControl } from "@/components/ui/increment-decrement-control";
import { Keyframe } from "@/components/ui/keyframe";
import { PanelSection } from "@/components/ui/panel-section";
import { Progress } from "@/components/ui/progress";
import { SegmentedIconTabs } from "@/components/ui/segmented-icon-tabs";
import { Select, SelectContent, SelectItem, SelectPortal, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SliderInput } from "@/components/ui/slider-input";
import { Switch, SwitchControl, SwitchInput, SwitchThumb } from "@/components/ui/switch";
import { ControlledTextField } from "@/components/ui/text-field";
import { useHas, useTrait, useWorld } from "@diffusionstudio/koota-solid";
import {
  AssetId, Computed, Effect, Hidden, Library, Mask, Name, VideoDecoderHandle, getParentNode,
} from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { syncKeyframe } from "@/engine/keyframes";
import {
  brushRadius,
  canRestoreObjectMask,
  clearObjectTrack,
  getMaskRestore,
  getMaskRestoreOf,
  getObjectTrack,
  objectMaskMode,
  objectMaskModel,
  objectMaskModelLoad,
  pickObjectMaskModel,
  preloadObjectMaskModel,
  restoreObjectMask,
  setBrushRadius,
  setObjectMaskMode,
  targetEffect,
  trackObjectMask,
  undoMaskStroke,
  useObjectMasks,
} from "@/engine/object-mask";
import { effectOption } from "./effect-types";

import type { Entity, World } from "koota";
import type { MaskAsset } from "@diffusionstudio/assets";
import type { Sam2Model, Sam2ModelId } from "@diffusionstudio/sam2/models";
import type {
  MaskRestore,
  ObjectMaskMode,
  ObjectMaskModelLoad,
  ObjectMaskSource,
  ObjectTrackStatus,
} from "@/engine/object-mask";

const MODE_TABS = [
  { value: "points", label: "Points" },
  { value: "brush", label: "Brush" },
] as const satisfies readonly { value: ObjectMaskMode; label: string }[];

/** What each model is picked for: tiny at half resolution, the others at the full 1024. */
const MODEL_NOTES: Record<Sam2ModelId, string> = {
  tiny: "Fastest",
  small: "Finer edges",
  "base-plus": "Small objects",
  large: "Best, slowest",
};

/** The brush's size on its slider: its diameter, in percent of the frame's height. */
const BRUSH_SIZE = { min: 1, max: 30 };

type SessionState = {
  status: ObjectTrackStatus | null;
  completed: number;
  total: number;
  error: string | null;
  points: number;
  strokes: number;
};

/**
 * The object mask tool's panel, the sidebar while the tool is up: how to
 * prompt (hover a video for the segment under the pointer, click to pick),
 * where the session stands, and the button that tracks the picked object
 * through its clip and writes the mask into the document — an opacity
 * effect with a `<mask>` on the clip, whose settings then open from the
 * effect's inspector.
 */
export function ObjectMaskPanel() {
  const world = useWorld();

  const state = useDerived<SessionState | null>(() => {
    const track = getObjectTrack();
    if (!track) return null;
    return {
      status: track.status,
      completed: track.completed,
      total: track.masks.length,
      error: track.error,
      points: track.points.length,
      strokes: track.strokes.length,
    };
  }, sameState);

  const busy = () => {
    const status = state()?.status;
    return status === "loading" || status === "segmenting" || status === "tracking" || status === "saving";
  };

  // Where the mask goes: under the effect the tool was started for, else
  // under an opacity effect on the clip — the cut-out.
  const destination = () => {
    const effect = targetEffect();
    if (!effect?.isAlive()) return "The tracked mask goes under an Opacity effect on the clip: the cut-out.";
    const clip = getParentNode(effect);
    const label = effectOption(effect.get(Effect)?.type).label;
    const name = clip?.get(Name)?.value;
    return `The tracked mask goes under ${label}${name ? ` on ${name}` : ""}.`;
  };

  // The model is fetched as the tool opens, so it is ready by the first click.
  onMount(preloadObjectMaskModel);

  // The chosen model's load, while it is under way or failed; a restore's other model is not shown.
  const modelLoad = () => {
    const load = objectMaskModelLoad();
    return load && load.id === objectMaskModel() && load.phase !== "ready" ? load : null;
  };
  // A restore holds the model too: switching would take it away mid-way.
  const restoring = useDerived(() => getMaskRestore() !== null);

  // Which models are on this machine already, looked at again as loads finish.
  const [cached] = createResource(
    () => objectMaskModelLoad()?.phase ?? "idle",
    async () => (await import("@diffusionstudio/sam2")).cachedSam2Models(),
  );
  const modelTag = (model: Sam2Model) =>
    cached()?.has(model.id) ? MODEL_NOTES[model.id] : `${MODEL_NOTES[model.id]} · ${formatSize(downloadSize(model))}`;

  return (
    <PanelSection title="Object Mask">
      <ControlRow label="Model">
        <Select<Sam2Model>
          value={sam2Model(objectMaskModel())}
          options={[...SAM2_MODELS]}
          optionValue="id"
          optionTextValue="label"
          disabled={busy() || restoring()}
          onChange={(model) => model && pickObjectMaskModel(model.id)}
          itemComponent={(itemProps) => (
            <SelectItem item={itemProps.item}>
              <div class="flex min-w-0 flex-1 items-center">
                <span>{itemProps.item.rawValue.label}</span>
                <span class="ml-auto pl-3 text-xxs text-muted-foreground group-[[data-highlighted]]:text-[inherit]">
                  {modelTag(itemProps.item.rawValue)}
                </span>
              </div>
            </SelectItem>
          )}
        >
          <SelectTrigger>
            <SelectValue<Sam2Model>>
              {(select) => (
                <>
                  <span>{select.selectedOption()?.label}</span>
                  <span class="ml-auto text-xxs text-muted-foreground">
                    {select.selectedOption() && modelTag(select.selectedOption())}
                  </span>
                </>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectPortal>
            <SelectContent />
          </SelectPortal>
        </Select>
      </ControlRow>
      <Show when={modelLoad()}>
        {(load) => (
          <div class="flex flex-col gap-2">
            <span class="text-xs" classList={{ "text-destructive": load().phase === "error" }}>
              {describeModelLoad(load())}
            </span>
            <Show when={load().phase === "download"}>
              <Progress value={load().progress ?? 0} minValue={0} maxValue={1} />
            </Show>
            <Show when={load().phase === "error"}>
              <div>
                <Button size="small" variant="ghost" onClick={preloadObjectMaskModel}>
                  Retry
                </Button>
              </div>
            </Show>
          </div>
        )}
      </Show>
      <SegmentedIconTabs value={objectMaskMode} onChange={setObjectMaskMode} items={MODE_TABS} />
      <Show
        when={objectMaskMode() === "brush"}
        fallback={
          <p class="text-xs text-muted-foreground">
            Hover a video clip to see what a click picks. Click to mask the object on this frame; more clicks refine
            it, alt-click marks background. Then track it through the clip.
          </p>
        }
      >
        <p class="text-xs text-muted-foreground">
          Paint over the mask to add what it missed; alt-drag erases what it should not have. Click the object with
          Points first: the brush corrects the mask, and tracking follows the corrected shape.
        </p>
        <ControlRow label="Size">
          <SliderInput
            value={Math.round(brushRadius() * 200)}
            min={BRUSH_SIZE.min}
            max={BRUSH_SIZE.max}
            onChange={(value) => setBrushRadius(Math.min(BRUSH_SIZE.max, Math.max(BRUSH_SIZE.min, value)) / 200)}
            format={(value) => `${value}%`}
          />
        </ControlRow>
      </Show>
      <p class="text-xs text-muted-foreground">{destination()}</p>

      <Show when={state()}>
        {(session) => (
          <div class="flex flex-col gap-2">
            <span class="text-xs" classList={{ "text-destructive": session().status === "error" }}>
              {describe(session())}
            </span>
            <Show when={session().status === "tracking"}>
              <Progress value={progress(session())} minValue={0} maxValue={1} />
            </Show>
          </div>
        )}
      </Show>

      <div class="flex items-center gap-2">
        <Button size="small" disabled={state()?.status !== "seeded"} onClick={() => trackObjectMask(world)}>
          Track mask
        </Button>
        <Show when={state()?.status === "seeded" && state()!.strokes > 0}>
          <Button size="small" variant="ghost" onClick={() => undoMaskStroke(world)}>
            Undo stroke
          </Button>
        </Show>
        <Show when={state()}>
          <Button size="small" variant="ghost" onClick={clearObjectTrack}>
            {busy() ? "Cancel" : "Clear"}
          </Button>
        </Show>
      </div>
    </PanelSection>
  );
}

type ObjectMaskInspectorProps = {
  /** The `<mask>`; its `src` is the tracked picture. */
  mask: Entity;
  anchorRef: HTMLElement;
  onClose(): void;
};

/**
 * One `<mask>`'s settings, opened from its row in the effect's inspector the
 * way a paint opens its picker: which tracked mask of the clip it is (the
 * header), how strongly it limits the effect, smoothing, feather and
 * inversion, plus a way to hide it; its row in the effect removes it. A mask
 * whose file cannot be read — its decoder failed, as a video's does — can be
 * restored from its recipe.
 */
export function ObjectMaskInspector(props: ObjectMaskInspectorProps) {
  const world = useWorld();
  const editor = useEditor();

  const hidden = useHas(() => props.mask, Hidden);
  const mask = useTrait(() => props.mask, Mask);

  const maskAsset = (): MaskAsset | null => {
    const asset = world.get(Library)?.get(props.mask.get(AssetId)?.value ?? "");
    return asset?.type === "MASK" ? asset : null;
  };
  const failed = useDerived(() => props.mask.get(VideoDecoderHandle)?.errored ?? false);
  const restorable = useDerived(() => {
    const library = world.get(Library);
    const asset = maskAsset();
    return !!library && !!asset && canRestoreObjectMask(library, asset);
  });
  const restoring = useDerived(() => {
    const restore = getMaskRestoreOf(maskAsset());
    return restore ? describeRestore(restore) : null;
  });

  const restore = () => {
    const asset = maskAsset();
    if (asset) restoreObjectMask(world, asset);
  };
  const feather = useDerived(() => props.mask.get(Computed)?.blur ?? 0);
  const opacity = useDerived(() => props.mask.get(Computed)?.opacity ?? 1);

  /** Feather is the mask's blur, which is what the renderer reads it as. */
  const editFeather = (next: number) => {
    const value = Math.max(0, Math.round(next));
    editor.editProperty(props.mask, "blur", value === 0 ? false : value);
    syncKeyframe(world, editor, props.mask, "blur", value);
  };

  /** How strongly the mask limits the effect (its opacity); full strength is the prop's absence. */
  const editOpacity = (percent: number) => {
    const value = Math.min(1, Math.max(0, percent / 100));
    editor.editProperty(props.mask, "opacity", value === 1 ? false : value);
    syncKeyframe(world, editor, props.mask, "opacity", value);
  };

  const editInverted = (inverted: boolean) => {
    editor.editProperty(props.mask, "inverted", inverted ? true : false);
  };

  /** How much the edge is smoothed; the default is the prop's absence. */
  const editSmoothing = (percent: number) => {
    const value = Math.min(1, Math.max(0, Math.round(percent) / 100));
    editor.editProperty(props.mask, "smoothing", value === DEFAULT_MASK_SMOOTHING ? false : value);
  };

  const toggleHidden = () => {
    editor.editProperty(props.mask, "hidden", !hidden());
  };

  const name = useDerived(() => objectMaskName(world, props.mask));

  // The tracked masks of the clip's footage: the header picks which of them this mask is.
  const { masks: sources } = useObjectMasks(() => getParentNode(getParentNode(props.mask)));
  const source = () => sources().find((option) => option.asset.id === props.mask.get(AssetId)?.value);

  /** Points the mask at another tracked mask's frames, placed where they were written for. */
  const switchSource = (next: ObjectMaskSource | null) => {
    if (!next || next.asset.id === source()?.asset.id) return;
    editor.editProperty(props.mask, "src", next.asset.path);
    editor.editProperty(props.mask, "sourceIn", next.sourceIn > 0 ? next.sourceIn : false);
  };

  return (
    <FloatingInspector open anchorRef={props.anchorRef} width={248}>
      <FloatingInspectorHeader class="items-center justify-between px-2">
        <Select<ObjectMaskSource>
          value={source()}
          onChange={switchSource}
          options={sources()}
          optionValue={(option) => option.asset.id}
          optionTextValue="name"
          itemComponent={(itemProps) => (
            <SelectItem item={itemProps.item}>
              {itemProps.item.rawValue.name}
            </SelectItem>
          )}
        >
          <SelectTrigger>
            <SelectValue<ObjectMaskSource>>
              {(state) => state.selectedOption()?.name ?? name()}
            </SelectValue>
          </SelectTrigger>
          <SelectPortal>
            <SelectContent />
          </SelectPortal>
        </Select>
        <div class="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={toggleHidden}
            >
              <Show when={!hidden()} fallback={<Icon name="eye-off" />}>
                <Icon name="eye-on" />
              </Show>
            </TooltipTrigger>
            <TooltipContent>{hidden() ? "Show mask" : "Hide mask"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={props.onClose}
            >
              <Icon name="close-remove" />
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        </div>
      </FloatingInspectorHeader>
      <FloatingInspectorSeparator />
      <FloatingInspectorContent class="flex flex-col gap-2 px-4 pt-3 pb-4">
        <Show when={failed()}>
          <div class="flex flex-col gap-2 pb-2">
            <span class="flex items-center gap-1.5 text-xs">
              <Icon name="alert-warning" class="size-4 shrink-0 text-destructive" />
              The mask file could not be loaded.
            </span>
            <Show
              when={restoring()}
              fallback={
                <Show when={restorable()}>
                  <div>
                    <Button size="small" onClick={restore}>
                      Restore
                    </Button>
                  </div>
                </Show>
              }
            >
              {(text) => <span class="text-xs text-muted-foreground">{text()}</span>}
            </Show>
          </div>
          <FloatingInspectorSeparator class="-mx-4 mb-2" />
        </Show>
        <ControlRow label="Strength">
          <SliderInput
            value={Math.round(opacity() * 100)}
            min={0}
            max={100}
            onChange={editOpacity}
            format={(value) => `${value}%`}
            keyframe={<Keyframe target={props.mask} property="opacity" />}
          />
        </ControlRow>
        <ControlRow label="Smoothing">
          <SliderInput
            value={Math.round((mask()?.smoothing ?? DEFAULT_MASK_SMOOTHING) * 100)}
            min={0}
            max={100}
            onChange={editSmoothing}
            format={(value) => `${value}%`}
          />
        </ControlRow>
        <ControlRow label="Feather" contentClass="grid grid-cols-2 gap-2">
          <ControlledTextField
            value={Math.round(feather())}
            onNumber={editFeather}
            unit="px"
            min={0}
            autoSelect
            sliderEnabled
            limitEvents
            keyframe={<Keyframe target={props.mask} property="blur" />}
          />
          <IncrementDecrementControl
            onDecrement={() => editFeather(feather() - 1)}
            onIncrement={() => editFeather(feather() + 1)}
            decrementLabel="Decrease feather"
            incrementLabel="Increase feather"
          />
        </ControlRow>
        <ControlRow label="Invert" class="h-7">
          <Switch checked={mask()?.inverted ?? false} onChange={editInverted}>
            <SwitchInput />
            <SwitchControl variant="compact">
              <SwitchThumb variant="compact" />
            </SwitchControl>
          </Switch>
        </ControlRow>
      </FloatingInspectorContent>
    </FloatingInspector>
  );
}

/** What a `<mask>` is called: its file's name in the library, without the extension. */
export function objectMaskName(world: World, mask: Entity): string {
  const asset = world.get(Library)?.get(mask.get(AssetId)?.value ?? "");
  return asset ? assetName(asset).replace(/\.[^.]+$/, "") : "Mask";
}

function describe(state: SessionState): string {
  const strokes = state.strokes === 0 ? "" : ` and ${state.strokes} ${state.strokes === 1 ? "stroke" : "strokes"}`;
  const points = `${state.points} ${state.points === 1 ? "point" : "points"}${strokes}`;
  switch (state.status) {
    case "loading":
      return "Waiting for the model...";
    case "segmenting":
      return `Masking from ${points}...`;
    case "seeded":
      return `Masked this frame from ${points}. Track it to mask the whole clip.`;
    case "tracking":
      return `Tracking, ${state.completed} of ${state.total} frames`;
    case "saving":
      return "Saving the mask...";
    case "error":
      return state.error ?? "Tracking failed";
    default:
      return "";
  }
}

function progress(state: SessionState): number {
  return state.total === 0 ? 0 : state.completed / state.total;
}

function describeModelLoad(load: ObjectMaskModelLoad): string {
  const label = sam2Model(load.id).label;
  switch (load.phase) {
    case "download":
      return load.progress === null ? `Downloading ${label}...` : `Downloading ${label}, ${Math.floor(load.progress * 100)}%`;
    case "compile":
      return `Preparing ${label}...`;
    case "error":
      return load.error ?? `${label} could not be loaded`;
    default:
      return "";
  }
}

function formatSize(bytes: number): string {
  return `${Math.round(bytes / 1e6)} MB`;
}

function describeRestore(restore: MaskRestore): string {
  switch (restore.status) {
    case "loading":
      return restore.download === null
        ? "Preparing the model..."
        : `Downloading the model, ${Math.round(restore.download * 100)}%`;
    case "tracking":
      return `Restoring, ${restore.completed} of ${restore.total} frames`;
    case "saving":
      return "Saving the mask...";
  }
}

function sameState(a: SessionState | null, b: SessionState | null): boolean {
  if (a === null || b === null) return a === b;
  return (Object.keys(a) as (keyof SessionState)[]).every((key) => a[key] === b[key]);
}
