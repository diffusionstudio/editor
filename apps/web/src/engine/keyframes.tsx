/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Keyframes as edits. In the source a keyframed prop is a `<keyframeTrack
 * property>` under the element whose prop it drives, holding `<keyframe time
 * value easing>` children; so adding a keyframe inserts an element, changing
 * one writes its `value`, and removing the last one removes the track. These
 * are the runtime's `toggleKeyframeTrack`/`syncKeyframeTrack`/
 * `removeKeyframeTrack` in that vocabulary, routed through the editor so the
 * file hears about them. Properties are named as the JSX names them
 * (`AnimatableProperty`), the way a track in the file is.
 */

import { Keyframe as KeyframeElement, KeyframeTrack as KeyframeTrackElement, trackPropertyPath } from "@diffusionstudio/reconciler";
import {
  Cache,
  ChildOf,
  Keyframe,
  KeyframeTrack,
  FrameRate,
  colorToHex,
  findKeyframeTargetNode,
  framesToSeconds,
  getNodeLocalFrame,
  getPropertyPaths,
} from "@diffusionstudio/runtime";

import type { AnimatableProperty } from "@diffusionstudio/jsx";
import type { Entity, World } from "@diffusionstudio/koota";
import type { DocumentEditor } from "./editor";

/** The track driving `target`'s `property`, if any. */
export function findKeyframeTrack(world: World, target: Entity, property: AnimatableProperty): Entity | null {
  const path = trackPropertyPath(target, property);
  if (!path) return null;
  for (const track of world.query(KeyframeTrack, ChildOf(target))) {
    if (track.get(KeyframeTrack)!.property === path) return track;
  }
  return null;
}

/** The keyframe of `track` at local `frame`, if any. */
export function findKeyframeAt(track: Entity, frame: number): Entity | null {
  const keyframes = track.get(Cache)?.keyframes ?? [];
  return keyframes.find((keyframe) => Math.round(keyframe.get(Keyframe)!.time) === frame) ?? null;
}

/** The local frame `target`'s keyframes are authored at: its node's, in the node's source time. */
export function keyframeFrame(target: Entity): number | null {
  const node = findKeyframeTargetNode(target);
  return node === null ? null : getNodeLocalFrame(node);
}

/**
 * The value of `target`'s `property` as shown right now: the computed one,
 * which is what a keyframe added here should hold. Colors come back as the
 * CSS hex a color track's keyframe is spelled with.
 */
function currentValue(world: World, target: Entity, property: AnimatableProperty): number | string | null {
  const path = trackPropertyPath(target, property);
  if (!path) return null;
  const value = getPropertyPaths(world)[path]?.computed[target.id()];
  if (typeof value !== "number") return null;
  return property === "color" ? colorToHex(value) : value;
}

/** A keyframe's `time` as the file spells it: seconds of this project's frame rate. */
function keyframeTime(world: World, frame: number): number {
  return framesToSeconds(frame, world.get(FrameRate)?.value ?? 30);
}

/**
 * Writes a keyframe for `target`'s `property` at the current local frame
 * holding `value` (the shown value when omitted): the keyframe already there
 * takes the value, else one is inserted, into the track or into a new track.
 * Returns the keyframe, or null when the target is not keyframable (no node
 * above it, no source to write under, a property it does not have).
 */
export function writeKeyframe(world: World, editor: DocumentEditor, target: Entity, property: AnimatableProperty, value?: number | string): Entity | null {
  const frame = keyframeFrame(target);
  if (frame === null) return null;
  const held = value ?? currentValue(world, target, property);
  if (held === null) return null;

  const track = findKeyframeTrack(world, target, property);
  const existing = track && findKeyframeAt(track, frame);
  if (existing) {
    editor.editProperty(existing, "value", held);
    return existing;
  }

  const time = keyframeTime(world, frame);
  if (track) {
    const [keyframe] = editor.insertElement(track, () => <KeyframeElement time={time} value={held} />);
    return keyframe ?? null;
  }

  const [created] = editor.insertElement(target, () => (
    <KeyframeTrackElement property={property}>
      <KeyframeElement time={time} value={held} />
    </KeyframeTrackElement>
  ));
  return created ? findKeyframeAt(created, frame) : null;
}

/**
 * Adds a keyframe for `target`'s `property` at the current local frame, or
 * removes the one already there; the track goes with its last keyframe.
 */
export function toggleKeyframe(world: World, editor: DocumentEditor, target: Entity, property: AnimatableProperty): void {
  const frame = keyframeFrame(target);
  if (frame === null) return;

  const track = findKeyframeTrack(world, target, property);
  const existing = track && findKeyframeAt(track, frame);
  if (!existing) {
    writeKeyframe(world, editor, target, property);
    return;
  }

  const last = (track.get(Cache)?.keyframes.length ?? 0) <= 1;
  editor.remove(last ? track : existing);
}

/**
 * Keeps a keyframed prop's track in step with an edit of its value: the
 * keyframe at the current frame takes `value`, or one is added holding it.
 * Nothing happens without a track; editing surfaces call this after
 * writing the prop, since the motion system would otherwise overwrite the
 * edit on the next tick.
 */
export function syncKeyframe(world: World, editor: DocumentEditor, target: Entity, property: AnimatableProperty, value: number | string): void {
  if (findKeyframeTrack(world, target, property) === null) return;
  writeKeyframe(world, editor, target, property, value);
}

/** Removes the track driving `target`'s `property`, keyframes included. */
export function removeKeyframeTrack(world: World, editor: DocumentEditor, target: Entity, property: AnimatableProperty): void {
  const track = findKeyframeTrack(world, target, property);
  if (track) editor.remove(track);
}
