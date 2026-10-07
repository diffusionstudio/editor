/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Computed, Fonts, FrameRate, getActiveEntity } from "@diffusionstudio/runtime";
import { getProjectsRoot } from "@/projects";

import type { ToolHandler } from "../handler";

/**
 * What the project's source cannot say. The JSX is the composition — its
 * scenes, what is selected, which scene is active, the work area are all in
 * the file, and a caller that wants them reads it. What is left over is which
 * folder new projects go in, which project folder the app has open, where its
 * playhead sits, and which font families are actually registered in the
 * world drawing it.
 * With no project open only the root is left to report.
 */
export const context: ToolHandler<"context"> = async (_, ctx) => {
  const rootDir = await getProjectsRoot();

  const open = ctx.session();
  if (!open) return { rootDir, projectDir: null, currentTime: null, fontFamilies: [] };

  const { world, project } = open;
  const frameRate = world.get(FrameRate)?.value || 30;
  const active = getActiveEntity(world);

  return {
    rootDir,
    projectDir: project.dir(),
    // Seconds, the unit the source places clips in; null when no scene is
    // active, which is when there is no playhead to report.
    currentTime: active ? (active.get(Computed)?.localTime ?? 0) / frameRate : null,
    // What text can be drawn with right now: registered in the world, not
    // merely named in the source. The editor default is always among them.
    fontFamilies: [...new Set(["Inter", ...(world.get(Fonts)?.list ?? []).map((f) => f.family)])],
  };
};
