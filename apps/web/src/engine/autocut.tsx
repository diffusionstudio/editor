/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * One-shot Autocut on a selected timeline clip: analyze silences + transcript,
 * then replace the clip with a row of trimmed copies in a sequence.
 */

import { Audio, Sequence, Video, authoredElement, authoredTree, renderAuthored } from "@diffusionstudio/reconciler";
import type { AuthoredTree } from "@diffusionstudio/reconciler";
import {
  FrameRate,
  autocutWouldChange,
  computeAutocut,
  findGeometryAsset,
  framesToSeconds,
  getEntityChildren,
  getLibrary,
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
import { mediaSrcFromAuthored, isAutocutAssetType, mergeAuthoredTiming, trimmedClipTiming } from "./autocut-helpers";

import type { AudioAsset, VideoAsset } from "@diffusionstudio/assets";
import type { Entity, World } from "koota";

export { autocutWouldChange, planAutocutTimeline };

const TIMING_PROPS = new Set(["start", "end", "sourceIn", "sourceOut"]);

export { isAutocutAssetType, mediaSrcFromAuthored, mergeAuthoredTiming, trimmedClipTiming } from "./autocut-helpers";

/** Whether a selected timeline node is a single Autocut target (library or path-based). */
export function isAutocutClip(world: World, entity: Entity): boolean {
  const asset = findGeometryAsset(world, entity);
  if (asset && isAutocutAssetType(asset.type)) return true;

  const authored = authoredElement(entity);
  if (!authored) return false;
  if (authored.tag === "video" || authored.tag === "audio") {
    return mediaSrcFromAuthored(authored.tag, authored.props.src) !== null;
  }
  return false;
}

export function clipSourcePath(world: World, entity: Entity): string | null {
  const authored = authoredElement(entity);
  if (!authored) return null;

  const direct = mediaSrcFromAuthored(authored.tag, authored.props.src);
  if (direct) return direct;

  const tree = authoredTree(world, entity);
  if (!tree) return null;
  for (const child of tree.children) {
    if (child.tag !== "videoPaint") continue;
    const src = child.props.src;
    if (typeof src === "string" && src.length > 0) return src;
  }
  return null;
}

/** Resolve media for waveform/transcribe: library AssetId or transient `src`. */
export async function resolveTimelineMediaAsset(
  world: World,
  entity: Entity,
): Promise<VideoAsset | AudioAsset | null> {
  const bound = findGeometryAsset(world, entity);
  if (bound && isAutocutAssetType(bound.type)) {
    return bound as VideoAsset | AudioAsset;
  }

  const path = clipSourcePath(world, entity);
  if (!path) return null;

  const asset = await getLibrary(world).resolve(path);
  if (asset.type !== "VIDEO" && asset.type !== "AUDIO") return null;
  return asset;
}

export async function analyzeClipForAutocut(
  world: World,
  entity: Entity,
  projectDir: string | undefined,
): Promise<AutocutResult> {
  const asset = await resolveTimelineMediaAsset(world, entity);
  if (!asset) throw new Error("Could not resolve the clip's media source.");

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

function spellClip(world: World, entity: Entity): AuthoredTree | undefined {
  const tree = authoredTree(world, entity);
  if (!tree) return undefined;
  const props = { ...tree.props };
  delete props.selected;
  delete props.active;
  return { ...tree, props };
}

function renderAuthoredCopy(tree: AuthoredTree, spec: AutocutClipSpec) {
  return renderAuthored({
    ...tree,
    props: mergeAuthoredTiming(tree.props as Record<string, unknown>, spec),
  });
}

function renderDirectClip(tag: string, src: unknown, spec: AutocutClipSpec, props: Record<string, unknown>) {
  const timing = trimmedClipTiming(spec);
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
  const isDirect = tag === "video" || tag === "audio";
  const geometryTree = isDirect ? undefined : spellClip(world, entity);
  if (!isDirect && !geometryTree) return [];

  const src = isDirect ? authored.props.src : undefined;
  const props = isDirect ? staticProps(authored.props as Record<string, unknown>) : undefined;

  const siblings = getEntityChildren(world, parent);
  const anchor = siblings[siblings.indexOf(entity) + 1];

  editor.remove(entity);

  const insertCopy = (spec: AutocutClipSpec) =>
    isDirect
      ? () => renderDirectClip(tag, src, spec, props!)
      : () => renderAuthoredCopy(geometryTree!, spec);

  const rowParent = isGroup(parent) || isSequence(parent) ? parent : null;
  if (rowParent) {
    const created: Entity[] = [];
    for (const spec of specs) {
      created.push(...editor.insertElement(rowParent, insertCopy(spec), anchor));
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
    created.push(...editor.insertElement(sequence, insertCopy(spec)));
  }
  if (created.length) editor.select(created);
  return created;
}

export function timelineStartSeconds(world: World, entity: Entity): number {
  const fps = world.get(FrameRate)?.value ?? 30;
  return framesToSeconds(authoredTime(world, entity, "start") ?? 0, fps);
}
