/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AssetId, Computed, Fonts, FrameRate, Generating, getActiveEntity, Library, Name, PendingSource, Source, SourceError } from "@diffusionstudio/runtime";
import { getProjectsRoot } from "@/projects";

import type { Entity, World } from "koota";
import type { GenerationRow } from "@diffusionstudio/dapi";
import type { ToolHandler } from "../handler";

/**
 * What the project's source cannot say. The JSX is the composition — its
 * scenes, what is selected, which scene is active, the work area are all in
 * the file, and a caller that wants them reads it. What is left over is which
 * folder projects live under, which project folder the app has open, where its
 * playhead sits, which font families are actually registered in the world
 * drawing it. With no project open only the root is left to report.
 */
export const context: ToolHandler<"context"> = async (_, ctx) => {
  const rootDir = await getProjectsRoot();

  const open = ctx.session();
  if (!open) return { rootDir, projectDir: null };

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
    generations: collectGenerations(world),
  };
};

function collectGenerations(world: World): GenerationRow[] {
  const library = world.get(Library);
  const rows: GenerationRow[] = [];
  const seen = new Set<string>();

  const push = (row: GenerationRow) => {
    const key = JSON.stringify(row);
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };

  for (const entity of world.query(Generating)) {
    push({ ...describeElement(entity), state: "generating" });
  }

  for (const entity of world.query(SourceError)) {
    const failure = entity.get(SourceError)!;
    if (!failure.generated) continue;
    push({ ...describeElement(entity), state: "failed", error: failure.value });
  }

  for (const entity of world.query(AssetId)) {
    // A stale binding — the element is off generating a new answer or failed
    // getting one — is not a generation that is done.
    if (entity.has(Generating) || entity.has(PendingSource) || entity.has(SourceError)) continue;
    const asset = library?.get(entity.get(AssetId)!.value);
    if (!asset?.generation) continue;
    push({ ...describeElement(entity), state: "done", asset: asset.path });
  }

  return rows;
}

function describeElement(entity: Entity): Pick<GenerationRow, "element" | "name"> {
  return {
    element: entity.get(Source)?.value || null,
    name: entity.get(Name)?.value || null,
  };
}
