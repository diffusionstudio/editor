/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createEffect, createMemo, createSignal } from "solid-js";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorTitle,
} from "@/components/ui/floating-inspector";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";
import { ControlRow } from "@/components/ui/control-group";
import { AssetThumbnail } from "@/components/ui/asset-thumbnail";
import { OpacitySwatch } from "@/components/ui/opacity-swatch";
import { ColorOpacityPicker } from "@/components/ui/color-opacity-picker";
import { assetName } from "@diffusionstudio/assets";
import { useHas, useTrait, useWorld } from "@diffusionstudio/koota-solid";
import { AssetId, Color, Computed, PaintType, colorToHex, getIntrinsicPaint, parseColor } from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { syncKeyframe } from "@/engine/keyframes";
import { useLibrary } from "@/engine/library";
import { FitMenu } from "./fill-picker";
import { AssetFillPicker } from "./asset-picker";

import type { Asset } from "@diffusionstudio/assets";
import type { Entity } from "@diffusionstudio/koota";

/** The row label, like a fill row's: which kind of media the node is. */
const MEDIA_LABELS: Partial<Record<PaintType, string>> = {
  [PaintType.VIDEO]: "Video",
  [PaintType.IMAGE]: "Image",
};

/** What a non-media intrinsic is, said instead of controls it cannot have. */
const INTRINSIC_LABELS: Partial<Record<PaintType, string>> = {
  [PaintType.HTML]: "HTML content",
  [PaintType.SURFACE]: "Canvas surface",
  [PaintType.WAVEFORM]: "Audio waveform",
};

type SourceSettingsProps = {
  selection: Entity[];
};

/**
 * What the node is intrinsically painted with, as its own section beneath
 * Fill, which mirrors the canvas: the intrinsics draw beneath every paint
 * child. Two rows can show — the intrinsic paint (a `<video>`'s footage, an
 * `<image>`'s picture, a `<surface>`'s canvas) and, beneath it as it draws,
 * the intrinsic solid (the `fill` prop). An intrinsic is not an element of
 * its own, so it offers exactly two things: another value (a `src` or `fill`
 * write, `objectFit` through the picker's fit menu — the node keeps its
 * identity) or removal. Removing the solid takes the prop off; removing the
 * media takes the element's nature off, rewriting it as the `<rect>` it
 * otherwise was (see `DocumentEditor.removeIntrinsicPaint`), and the section
 * goes with it. A surface or html intrinsic has neither; its row just says
 * what the node is made of.
 */
export function SourceSettings(props: SourceSettingsProps) {
  const editor = useEditor();
  const library = useLibrary();
  const entity = () => props.selection[0]!;

  let anchorRef!: HTMLDivElement;

  // One picker at a time: they anchor to the same section and would overlap.
  const [picking, setPicking] = createSignal<"media" | "solid">();

  const intrinsic = useDerived(() => getIntrinsicPaint(entity()));
  const isMedia = createMemo(
    () => intrinsic() === PaintType.VIDEO || intrinsic() === PaintType.IMAGE,
  );

  // The node's intrinsic solid (the `fill` prop, its Color trait): the other
  // intrinsic, drawn beneath even the intrinsic paint.
  const hasFill = useHas(() => entity(), Color);

  const assetId = useTrait(() => entity(), AssetId);
  const asset = createMemo(() => library()?.get(assetId()?.value ?? ""));

  // Same element, another source: the paint follows what the src turns out
  // to name (an image path onto a <video> paints as a picture), so a swap is
  // only ever a `src` write and the node keeps its identity.
  const handleSelectAsset = (picked: Asset) => {
    editor.editProperty(entity(), "src", picked.path);
  };

  // Removal is the element ceasing to be a media element: the node is
  // rewritten as the <rect> it otherwise was, and this section goes with it.
  const handleRemoveMedia = () => {
    setPicking(undefined);
    editor.removeIntrinsicPaint(entity());
  };

  return (
    <Show when={intrinsic() !== undefined || hasFill()}>
      <PanelSection title="Source" ref={anchorRef}>
        <Show
          when={isMedia()}
          fallback={
            <Show when={intrinsic() !== undefined}>
              <div class="flex h-7 items-center gap-2 rounded-md bg-input px-2 text-xs text-muted-foreground select-none">
                <Icon name="html-small" />
                <span class="min-w-0 truncate">
                  {INTRINSIC_LABELS[intrinsic()!] ?? "Intrinsic paint"}
                </span>
              </div>
            </Show>
          }
        >
          <ControlRow label={MEDIA_LABELS[intrinsic()!]}>
            <div class="flex h-7 w-full items-center overflow-hidden rounded-md border border-transparent bg-input text-foreground focus-within:border-primary">
              <button
                class="flex h-full min-w-0 flex-1 items-center gap-2 pl-1 text-left"
                onClick={() => setPicking("media")}
              >
                <span class="size-5 min-w-5 overflow-hidden rounded-sm">
                  <Show
                    when={asset()}
                    fallback={
                      <span class="flex size-full items-center justify-center bg-muted text-muted-foreground">
                        <Icon name="media-image" class="size-4" />
                      </span>
                    }
                  >
                    <AssetThumbnail
                      asset={asset()!}
                      class="size-full"
                      size={{ width: 50, height: 50 }}
                      cache={library()?.cache}
                    />
                  </Show>
                </span>
                <span class="min-w-0 flex-1 truncate text-xxs">
                  {asset() ? assetName(asset()!) : "No media"}
                </span>
              </button>
              <Tooltip>
                <TooltipTrigger
                  as={Button}
                  size="icon"
                  variant="ghost"
                  class="text-muted-foreground"
                  onClick={handleRemoveMedia}
                >
                  <Icon name="close-remove-small" />
                </TooltipTrigger>
                <TooltipContent>Remove media</TooltipContent>
              </Tooltip>
            </div>
          </ControlRow>
        </Show>

        <Show when={hasFill()}>
          <SolidFillRow
            node={entity()}
            anchorRef={anchorRef}
            picking={picking() === "solid"}
            onPickingChange={(open) => setPicking(open ? "solid" : undefined)}
          />
        </Show>
      </PanelSection>

      <Show when={picking() === "media"}>
        <FloatingInspector open anchorRef={anchorRef}>
          <FloatingInspectorHeader>
            <FloatingInspectorTitle>Source</FloatingInspectorTitle>
            <div class="ml-auto flex items-center gap-1">
              <FitMenu fill={entity()} />
              <Tooltip>
                <TooltipTrigger
                  as={Button}
                  size="icon"
                  variant="ghost"
                  class="text-muted-foreground"
                  onClick={() => setPicking(undefined)}
                >
                  <Icon name="close-remove" class="size-6" />
                </TooltipTrigger>
                <TooltipContent>Close</TooltipContent>
              </Tooltip>
            </div>
          </FloatingInspectorHeader>
          <FloatingInspectorContent class="p-0">
            <AssetFillPicker
              node={entity()}
              fill={entity()}
              onSelectAsset={handleSelectAsset}
            />
          </FloatingInspectorContent>
        </FloatingInspector>
      </Show>
    </Show>
  );
}

type SolidFillRowProps = {
  node: Entity;
  anchorRef: HTMLElement;
  picking: boolean;
  onPickingChange(open: boolean): void;
};

/**
 * The node's intrinsic solid: the `fill` prop, edited in place as a hex the
 * way a solid fill row edits its color, or through the picker the swatch
 * opens — both are `fill` prop writes, the node keeps its identity. Read
 * from `Computed.color` so it animates (the `color` keyframe track drives
 * the same trait); alpha is not offered because the prop ignores it. The X
 * takes the prop off the node.
 */
function SolidFillRow(props: SolidFillRowProps) {
  const world = useWorld();
  const editor = useEditor();

  const color = useDerived(() => props.node.get(Computed)?.color ?? 0xE0E0E0);
  const colorText = createMemo(() => colorToHex(color()).replace("#", ""));

  const updateColor = (next: number) => {
    const hex = colorToHex(next);
    editor.editProperty(props.node, "fill", hex);
    syncKeyframe(world, editor, props.node, "color", hex);
  };

  const handleRemoveFill = () => {
    props.onPickingChange(false);
    editor.editProperty(props.node, "fill", false);
  };

  const [draft, setDraft] = createSignal(colorText());
  let cancelCommit = false;

  createEffect(() => {
    setDraft(colorText());
  });

  const commit = () => {
    const next = parseColor(draft());
    if (next === null || next === color()) {
      setDraft(colorText());
      return;
    }
    editor.editProperty(props.node, "fill", colorToHex(next));
  };

  const handleKeyDown = (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }

    if (event.key !== "Escape") return;
    event.preventDefault();
    cancelCommit = true;
    setDraft(colorText());
    event.currentTarget.value = colorText();
    event.currentTarget.blur();
  };

  const handleBlur = (event: FocusEvent & { currentTarget: HTMLInputElement }) => {
    if (cancelCommit) {
      cancelCommit = false;
      event.currentTarget.value = colorText();
      return;
    }

    commit();
    event.currentTarget.value = colorText();
  };

  return (
    <ControlRow label="Solid">
      <div class="flex h-7 w-full items-center overflow-hidden rounded-md border border-transparent bg-input text-foreground focus-within:border-primary">
        <div class="flex h-full min-w-0 flex-1 items-center gap-2 pl-1">
          <button
            class="size-5 min-w-5 overflow-hidden rounded-sm"
            onClick={() => props.onPickingChange(true)}
          >
            <OpacitySwatch color={color()} opacity={1} />
          </button>
          <input
            type="text"
            value={draft()}
            class="w-[7ch] bg-transparent text-xxs outline-none"
            onInput={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
          />
        </div>
        <Tooltip>
          <TooltipTrigger
            as={Button}
            size="icon"
            variant="ghost"
            class="text-muted-foreground"
            onClick={handleRemoveFill}
          >
            <Icon name="close-remove-small" />
          </TooltipTrigger>
          <TooltipContent>Remove fill</TooltipContent>
        </Tooltip>
      </div>

      <Show when={props.picking}>
        <FloatingInspector open anchorRef={props.anchorRef}>
          <FloatingInspectorHeader>
            <FloatingInspectorTitle>Solid</FloatingInspectorTitle>
            <div class="ml-auto flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger
                  as={Button}
                  size="icon"
                  variant="ghost"
                  class="text-muted-foreground"
                  onClick={() => props.onPickingChange(false)}
                >
                  <Icon name="close-remove" class="size-6" />
                </TooltipTrigger>
                <TooltipContent>Close</TooltipContent>
              </Tooltip>
            </div>
          </FloatingInspectorHeader>
          <FloatingInspectorContent class="p-0">
            <ColorOpacityPicker
              color={color()}
              opacity={1}
              onColorChange={updateColor}
              withoutOpacity
              keyframeTarget={props.node}
            />
          </FloatingInspectorContent>
        </FloatingInspector>
      </Show>
    </ControlRow>
  );
}
