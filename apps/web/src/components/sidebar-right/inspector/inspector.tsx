/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ControlScrollArea } from "@/components/ui/control-scrollarea";
import { Show, createMemo } from "solid-js";
import {
  ToolType,
  getParentNode,
  isAdjustmentLayer,
  isAudio,
  isCaption,
  isGroup,
  isMask,
  isScene,
  isSequence,
  isShape,
  isText,
} from "@diffusionstudio/runtime";
import { useAssetSelection, useSelection, useTool } from "@/engine/hooks";
import { InspectorHeader } from "./inspector-header";
import { BackgroundSettings } from "./background";
import { VariablesSettings } from "./variables";
import { SceneTemplatePanel } from "./scene-template";
import { AssetInfoPanel } from "./asset-info";
import { TimeSettings } from "./time";
import { AppearanceSettings } from "./appearance";
import { Alignment } from "./alignment";
import { ExportPanel } from "./export";
import { LayoutPanel } from "./layout";
import { TransformSettings } from "./transform";
import { CaptionSettings } from "./caption-settings";
import { TextPanel } from "./text";
import { FillsSettings } from "./fills";
import { SourceSettings } from "./source";
import { StrokesSettings } from "./strokes";
import { ShadowsSettings } from "./shadows";
import { EffectsSettings } from "./effects";
import { AnimationsSettings } from "./animations";
import { TransitionSettings } from "./transition";
import { MasksSettings } from "./masks";
import { AudioSettings } from "./audio";
import { InterpolationSettings } from "./interpolation";
import { isCompanionExportDisabled } from "@/lib/companion-export";
import { CompanionAuthoringBoundary } from "@/components/companion-authoring-boundary";

import type { Entity } from "koota";

export type SelectionTarget =
  | "scene-tool"
  | "keyframe"
  | "asset"
  | "scene"
  | "mask"
  | "sequence"
  | "caption"
  | "audio"
  | "adjustment"
  | "text"
  | "shape"
  | "group"
  | "stage";

function classifyNode(entity: Entity): SelectionTarget {
  if (isScene(entity)) return "scene";
  if (isMask(entity)) return "mask";
  if (isSequence(entity)) return "sequence";
  if (isCaption(entity)) return "caption";
  if (isAudio(entity)) return "audio";
  if (isAdjustmentLayer(entity)) return "adjustment";
  if (isText(entity)) return "text";
  if (isShape(entity)) return "shape";
  if (isGroup(entity)) return "group";
  return "stage";
}

export function Inspector() {
  const tool = useTool();
  const { nodes, keyframes, first } = useSelection();
  const { asset } = useAssetSelection();

  // For ExportPanel (root scenes only) and TransitionSettings (sequence items).
  const parent = createMemo(() => getParentNode(first()));
  const isNested = createMemo(() => parent() !== null);
  const isSequenceChild = createMemo(() => {
    const entity = parent();
    return entity !== null && isSequence(entity);
  });

  const selectionTarget = createMemo<SelectionTarget>(() => {
    if (tool() === ToolType.SCENE) return "scene-tool";
    if (keyframes().length > 0) return "keyframe";
    if (asset()) return "asset";
    const entity = first();
    if (nodes().length === 1 && entity) return classifyNode(entity);
    return "stage";
  });

  // Remounts the panels when the selection changes
  const selectionHash = createMemo(() => {
    return [...nodes(), ...keyframes(), asset()?.id ?? ""].join(",") + selectionTarget();
  });

  const includesTarget = (...targets: SelectionTarget[]) => {
    return targets.includes(selectionTarget());
  };

  return (
    <div class="h-full min-h-0 flex flex-col" data-right-sidebar>
      <InspectorHeader />
      <Show when={selectionHash()} keyed>
        <ControlScrollArea class="flex-1 min-h-0" scrollKey={selectionHash()}>
          <CompanionAuthoringBoundary>
            <Show when={includesTarget("scene-tool")}>
              <SceneTemplatePanel />
            </Show>

            <Show when={nodes().length > 1}>
              <Alignment />
            </Show>

            <Show when={!isCompanionExportDisabled() && includesTarget("scene") && !isNested()}>
              <ExportPanel selection={nodes()} />
            </Show>

            <Show when={includesTarget("stage")}>
              <BackgroundSettings />
            </Show>

            <Show when={includesTarget("stage")}>
              <VariablesSettings />
            </Show>

            <Show when={includesTarget("shape", "text", "audio", "scene", "caption", "group", "mask", "adjustment")}>
              <TimeSettings selection={nodes()} />
            </Show>

            <Show when={includesTarget("shape", "text", "audio", "scene", "caption", "group", "mask", "adjustment")}>
              <TransformSettings selection={nodes()} />
            </Show>

            <Show when={includesTarget("shape", "text", "audio", "scene", "mask")}>
              <LayoutPanel selection={nodes()} />
            </Show>

            <Show when={includesTarget("shape", "text", "scene", "caption", "group", "audio", "mask")}>
              <AppearanceSettings selection={nodes()} />
            </Show>

            <Show when={includesTarget("caption")}>
              <CaptionSettings selection={nodes()} />
            </Show>
          </CompanionAuthoringBoundary>

          <Show when={includesTarget("text", "caption")}>
            <TextPanel selection={nodes()} />
          </Show>

          <CompanionAuthoringBoundary>
            <Show when={includesTarget("shape", "text", "scene")}>
              <FillsSettings selection={nodes()} />
            </Show>

            <Show when={includesTarget("shape", "caption")}>
              <SourceSettings selection={nodes()} />
            </Show>

            <Show when={includesTarget("shape", "text", "scene", "caption")}>
              <StrokesSettings selection={nodes()} />
            </Show>

            <Show when={includesTarget("shape", "text", "scene")}>
              <ShadowsSettings selection={nodes()} />
            </Show>

            <Show when={includesTarget("shape", "text", "scene", "caption")}>
              <EffectsSettings selection={nodes()} />
            </Show>

            <Show when={includesTarget("shape", "text", "caption", "group", "mask")}>
              <AnimationsSettings selection={nodes()} />
            </Show>

            <Show when={includesTarget("shape") && isSequenceChild()}>
              <TransitionSettings selection={nodes()} />
            </Show>

            <Show when={includesTarget("shape", "text", "caption", "group")}>
              <MasksSettings selection={nodes()} />
            </Show>

            <Show when={includesTarget("shape", "audio", "group")}>
              <AudioSettings selection={nodes()} />
            </Show>

            <Show when={includesTarget("asset")}>
              <AssetInfoPanel />
            </Show>

            <Show when={includesTarget("keyframe")}>
              <InterpolationSettings selection={keyframes()} />
            </Show>
          </CompanionAuthoringBoundary>
        </ControlScrollArea>
      </Show>
    </div>
  );
}
