/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ToolType } from "@diffusionstudio/runtime";
import { AutoCaptionsCommand } from "./auto-captions";
import { CleanUpCommand } from "./clean-up";
import { EditWithPromptCommand } from "./edit-with-prompt";
import { ExportCurrentFrameCommand } from "./export-current-frame";
import { ExportVideoCommand } from "./export-video";
import { GenerateCommand } from "./generate";
import { LayerToggleCommands } from "./layer-toggles";
import { MakeVideoCommand } from "./make-video";
import { MediaAssetCommands } from "./media-asset";
import { ProjectFolderCommands } from "./project-folder";
import { RemoveBackgroundCommand } from "./remove-background";
import { RemoveSilenceCommand } from "./remove-silence";
import { RippleDeleteGapCommand } from "./ripple-delete-gap";
import { CloseGapLayerCommand } from "./close-gap-layer";
import { RerunCommand } from "./rerun";
import { ReuseSettingsCommand } from "./reuse-settings";
import { ShortcutCommands } from "./shortcuts";
import { ToolCommand } from "./tool";
import { UpscaleCommand } from "./upscale";
import { WindowCommands } from "./window";

export { CommandBar } from "./command-bar";
export { CommandPalette } from "./palette";
export { CANVAS_MENU, CommandContextMenu, NodeContextMenu, TIMELINE_HEADER_MENU, TIMELINE_MENU } from "./node-menu";
export { ReloadWindowCommand } from "./reload-window";

/**
 * The canvas's commands: what to generate, what the selected media can be
 * run through, the toolbar's tools, the keyboard shortcuts, where else
 * the project folder can be opened, and the panels around the canvas.
 */
export function CanvasCommands() {
  return (
    <>
      <GenerateCommand mode="IMAGE" />
      <GenerateCommand mode="VIDEO" />
      <GenerateCommand mode="VOICE" />
      <GenerateCommand mode="AUDIO" />
      <EditWithPromptCommand />
      <MakeVideoCommand />
      <RerunCommand />
      <ReuseSettingsCommand />
      <UpscaleCommand />
      <RemoveBackgroundCommand />
      <AutoCaptionsCommand />
      <RemoveSilenceCommand />
      <RippleDeleteGapCommand />
      <CloseGapLayerCommand />
      <MediaAssetCommands />
      <CleanUpCommand />
      <ExportVideoCommand />
      <ExportCurrentFrameCommand />
      <ToolCommand tool={ToolType.MOVE} />
      <ToolCommand tool={ToolType.HAND} />
      <ToolCommand tool={ToolType.OBJECT_MASK} />
      <ToolCommand tool={ToolType.SCENE} />
      <ToolCommand tool={ToolType.RECT} />
      <ToolCommand tool={ToolType.ELLIPSE} />
      <ToolCommand tool={ToolType.POLYGON} />
      <ToolCommand tool={ToolType.PEN} />
      <ToolCommand tool={ToolType.TEXT} />
      <ShortcutCommands />
      <LayerToggleCommands />
      <ProjectFolderCommands />
      <WindowCommands />
    </>
  );
}
