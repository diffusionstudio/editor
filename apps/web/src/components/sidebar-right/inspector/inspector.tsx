/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ControlScrollArea } from "@/components/ui/control-scrollarea";
import { Show, createMemo } from "solid-js";
import { InspectorHeader } from "./inspector-header";
import { Alignment } from "./alignment";
import { AnimationsSettings } from "./animations";
import { AudioSettings } from "./audio";
import { LayoutPanel } from "./layout";
import { EffectsSettings } from "./effects";
import { ExportPanel } from "./export";
import { FillsSettings } from "./fills";
import { AppearanceSettings } from "./appearance";
import { ShadowsSettings } from "./shadows";
import { StrokesSettings } from "./strokes";
import { AssetInfoPanel } from "./asset-info";
import { TimeSettings } from "./time";
import { TransformSettings } from "./transform";
import { BackgroundSettings } from "./background";
import { TransitionSettings } from "./transition";
import { MasksSettings } from "./masks";
import { InterpolationSettings } from "./interpolation";
import { CaptionSettings } from "./caption-settings";
import { getParentEntity, isAdjustmentLayer, isAudio, isCaption, isGroup, isMask, isScene, isSequence, isShape, isText, ToolType, useAssets } from "@/components/engine";
import { useEngine } from "@/context/engine";
import { SceneTemplatePanel } from "./scene-template";
import { TextPanel } from "./text";
import { ActiveInspectorProvider } from "./active-inspector";
import { useECS } from "@/context/ecs";

export function Inspector() {
  const { world } = useEngine();
  const assets = useAssets(world);
  const { selectedKeyframes, selectedTool, selectedNodes } = useECS();


  const firstEid = createMemo(() => selectedNodes().values().next().value);
  const parentEid = createMemo(() => getParentEntity(world, firstEid()));
  const isNested = createMemo(() => parentEid() != null);

  const isSequenceChild = createMemo(() => {
    const eid = parentEid();
    if (eid && isSequence(world, eid)) {
      return true;
    }

    return false;
  });

  const selectionTarget = createMemo(() => {
    const eid = firstEid();

    if (selectedTool() === ToolType.SCENE) {
      return "scene-tool";
    }

    if (selectedKeyframes().size > 0) {
      return "keyframe";
    }

    if (assets.selected().size > 0) {
      return "asset";
    }

    if (selectedNodes().size === 1 && eid) {
      // Order matters: scene check before plain group/shape since scenes are RECT+Group+ClipsContent.
      if (isScene(world, eid)) return "scene";
      if (isMask(world, eid)) return "mask";
      if (isSequence(world, eid)) return "sequence";
      if (isCaption(world, eid)) return "caption";
      if (isAudio(world, eid)) return "audio";
      if (isAdjustmentLayer(world, eid)) return "adjustment";
      if (isText(world, eid)) return "text";
      if (isShape(world, eid)) return "shape";
      if (isGroup(world, eid)) return "group";
    }

    return "stage";
  });

  const selectionHash = createMemo(() => {
    const nodes = Array.from(selectedNodes());
    const keyframes = Array.from(selectedKeyframes());
    return [...nodes, ...keyframes].join(',') + selectionTarget();
  });

  const includesTarget = (...targets: ReturnType<typeof selectionTarget>[]) => {
    return targets.includes(selectionTarget());
  };

  return (
    <div class="h-full min-h-0 flex flex-col" data-right-sidebar>
      <InspectorHeader />
      <Show when={selectionHash()} keyed>
        <ActiveInspectorProvider>
        <ControlScrollArea class="flex-1 min-h-0">
          <Show when={includesTarget("scene-tool")}>
            <SceneTemplatePanel />
          </Show>

          <Show when={selectedNodes().size > 1}>
            <Alignment />
          </Show>

          <Show when={includesTarget("scene") && !isNested()}>
            <ExportPanel selection={selectedNodes()} />
          </Show>

          <Show when={includesTarget("stage")}>
            <BackgroundSettings />
          </Show>

          <Show when={includesTarget("shape", "text", "audio", "scene", "caption", "group", "mask", "adjustment")}>
            <TimeSettings selection={selectedNodes()} />
          </Show>


          <Show when={includesTarget("shape", "text", "audio", "scene", "caption", "group", "mask", "adjustment")}>
            <TransformSettings selection={selectedNodes()} />
          </Show>

          <Show when={includesTarget("shape", "text", "audio", "scene", "caption", "mask")}>
            <LayoutPanel selection={selectedNodes()} />
          </Show>

          <Show when={includesTarget("shape", "text", "scene", "caption", "group", "audio", "mask")}>
            <AppearanceSettings selection={selectedNodes()} />
          </Show>

          <Show when={includesTarget("caption")}>
            <CaptionSettings selection={selectedNodes()} />
          </Show>

          <Show when={includesTarget("text", "caption")}>
            <TextPanel selection={selectedNodes()} />
          </Show>

          <Show when={includesTarget("shape", "text", "scene", "caption")}>
            <FillsSettings selection={selectedNodes()} />
          </Show>

          <Show when={includesTarget("shape", "text", "scene", "caption")}>
            <StrokesSettings selection={selectedNodes()} />
          </Show>

          <Show when={includesTarget("shape", "text", "scene", "caption")}>
            <ShadowsSettings selection={selectedNodes()} />
          </Show>

          <Show when={includesTarget("shape", "text", "scene", "caption")}>
            <EffectsSettings selection={selectedNodes()} />
          </Show>

          <Show when={includesTarget("shape", "text", "caption", "group", "mask")}>
            <AnimationsSettings selection={selectedNodes()} />
          </Show>

          <Show when={includesTarget("shape") && isSequenceChild()}>
            <TransitionSettings selection={selectedNodes()} />
          </Show>

          <Show when={includesTarget("shape", "text", "caption", "group")}>
            <MasksSettings selection={selectedNodes()} />
          </Show>

          <Show when={includesTarget("shape", "audio", "group")}>
            <AudioSettings selection={selectedNodes()} />
          </Show>

          <Show when={includesTarget("asset")}>
            <AssetInfoPanel />
          </Show>

          <Show when={includesTarget("keyframe")}>
            <InterpolationSettings />
          </Show>
        </ControlScrollArea>
        </ActiveInspectorProvider>
      </Show>
    </div>
  );
}
