/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * One-shot Autocut on a selected timeline clip: analyze silences + transcript,
 * then replace the clip with a row of trimmed copies in a sequence.
 */

import { Audio, Sequence, Video, authoredElement } from "@diffusionstudio/reconciler";
import {
  FrameRate,
  autocutWouldChange,
  computeAutocut,
  framesToSeconds,
  getEntityChildren,
  getNextName,
  getParentEntity,
  getSourceWindow,
  isGroup,
  isSequence,
  planAutocutTimeline,
  waveformAsset,
  type AutocutClipSpec,
  type AutocutResult,
  type Transcript,
} from "@diffusionstudio/runtime";

import { getDocumentEditor } from "./editor";
import { authoredTime } from "./timing";
import { transcribeAsset } from "@/media/transcribe-asset";

import type { AudioAsset, VideoAsset } from "@diffusionstudio/assets";
import type { Entity, World } from "koota";

export { autocutWouldChange, planAutocutTimeline };

const TIMING_PROPS = new Set(["start", "end", "sourceIn", "sourceOut"]);

export async function analyzeClipForAutocut(
  world: World,
  entity: Entity,
  asset: VideoAsset | AudioAsset,
  projectDir: string | undefined,
): Promise<AutocutResult> {
  const fps = world.get(FrameRate)?.value ?? 30;
  const source = getSourceWindow(entity);
  const sourceIn = framesToSeconds(source.in, fps);
  const sourceOut = framesToSeconds(source.out, fps);

  const { silences } = await waveformAsset(asset, { scale: 0.25 });
  const transcript: Transcript = await transcribeAsset(asset, projectDir);

  return computeAutocut(
    {
      duration: asset.duration,
      silences,
      transcript,
      window: { start: sourceIn, end: sourceOut },
    },
    { silenceMin: 0.4, pad: 0.05, lang: "all" },
  );
}

function staticProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!TIMING_PROPS.has(key) && key !== "src") out[key] = value;
  }
  return out;
}

function renderClip(tag: string, src: unknown, spec: AutocutClipSpec, props: Record<string, unknown>) {
  const timing = {
    start: spec.timelineStart,
    end: spec.timelineEnd,
    sourceIn: spec.sourceIn,
    sourceOut: spec.sourceOut,
  };
  if (tag === "audio") {
    return <Audio src={src as string} {...props} {...timing} />;
  }
  return <Video src={src as string} {...props} {...timing} />;
}

/** Replace one clip with trimmed copies on one timeline row. Returns the new entities. */
export function applyAutocutToClip(
  world: World,
  entity: Entity,
  specs: AutocutClipSpec[],
): Entity[] {
  const editor = getDocumentEditor(world);
  const authored = authoredElement(entity);
  if (!authored) return [];

  const parent = getParentEntity(entity);
  if (!parent) return [];

  const tag = authored.tag;
  if (tag !== "video" && tag !== "audio") return [];

  const src = authored.props.src;
  const props = staticProps(authored.props as Record<string, unknown>);

  const siblings = getEntityChildren(world, parent);
  const anchor = siblings[siblings.indexOf(entity) + 1];

  editor.remove(entity);

  const rowParent = isGroup(parent) || isSequence(parent) ? parent : null;
  if (rowParent) {
    const created: Entity[] = [];
    for (const spec of specs) {
      const inserted = editor.insertElement(rowParent, () => renderClip(tag, src, spec, props), anchor);
      created.push(...inserted);
    }
    if (created.length) editor.select(created);
    return created;
  }

  const [sequence] = editor.insertElement(
    parent,
    () => <Sequence name={getNextName(world, "Sequence")} />,
    anchor,
  );
  if (!sequence) return [];

  const created: Entity[] = [];
  for (const spec of specs) {
    created.push(...editor.insertElement(sequence, () => renderClip(tag, src, spec, props)));
  }
  if (created.length) editor.select(created);
  return created;
}

export function timelineStartSeconds(world: World, entity: Entity): number {
  const fps = world.get(FrameRate)?.value ?? 30;
  return framesToSeconds(authoredTime(world, entity, "start") ?? 0, fps);
}
