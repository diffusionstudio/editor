/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show } from "solid-js";
import { useHas, useWorld } from "@diffusionstudio/koota-solid";
import { Cache, Source } from "@diffusionstudio/runtime";
import { cx } from "@/lib/cva";
import { useDerived, useEditor } from "@/engine/hooks";
import { findKeyframeAt, findKeyframeTrack, findPaintKeyframeTracks, keyframeFrame, toggleKeyframe, togglePaintKeyframe } from "@/engine/keyframes";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

import type { AnimatableProperty } from "@diffusionstudio/jsx";
import type { Entity } from "koota";

type KeyframeProps = {
  target: Entity;
  property: AnimatableProperty;
  disabled?: boolean;
  class?: string;
};

type KeyframeState = { available: boolean; hasTrack: boolean; isActive: boolean };

const sameState = (a: KeyframeState, b: KeyframeState) =>
  a.available === b.available && a.hasTrack === b.hasTrack && a.isActive === b.isActive;

export function Keyframe(props: KeyframeProps) {
  const world = useWorld();
  const editor = useEditor();

  const state = useDerived((): KeyframeState => {
    const frame = keyframeFrame(props.target);
    if (frame === null) return { available: false, hasTrack: false, isActive: false };
    const track = findKeyframeTrack(world, props.target, props.property);
    const keyframes = track?.get(Cache)?.keyframes.length ?? 0;
    return {
      available: true,
      hasTrack: track !== null && keyframes > 0,
      isActive: track !== null && findKeyframeAt(track, frame) !== null,
    };
  }, sameState);

  return (
    <KeyframeToggle
      target={props.target}
      state={state()}
      onToggle={() => toggleKeyframe(world, editor, props.target, props.property)}
      disabled={props.disabled}
      class={props.class}
    />
  );
}

type PaintKeyframeProps = {
  paint: Entity;
  disabled?: boolean;
  class?: string;
};

/** One keyframe for every animatable prop of a paint; a gradient's stops keep their own. */
export function PaintKeyframe(props: PaintKeyframeProps) {
  const world = useWorld();
  const editor = useEditor();

  const state = useDerived((): KeyframeState => {
    const frame = keyframeFrame(props.paint);
    if (frame === null) return { available: false, hasTrack: false, isActive: false };
    let hasTrack = false;
    for (const track of findPaintKeyframeTracks(world, props.paint)) {
      if (findKeyframeAt(track, frame) !== null) return { available: true, hasTrack: true, isActive: true };
      hasTrack ||= (track.get(Cache)?.keyframes.length ?? 0) > 0;
    }
    return { available: true, hasTrack, isActive: false };
  }, sameState);

  return (
    <KeyframeToggle
      target={props.paint}
      state={state()}
      onToggle={() => togglePaintKeyframe(world, editor, props.paint)}
      disabled={props.disabled}
      class={props.class}
    />
  );
}

type KeyframeToggleProps = {
  target: Entity;
  state: KeyframeState;
  onToggle(): void;
  disabled?: boolean;
  class?: string;
};

function KeyframeToggle(props: KeyframeToggleProps) {
  const hasSource = useHas(() => props.target, Source);

  return (
    <Show when={hasSource() && props.state.available}>
      <Tooltip openDelay={600} disabled={props.disabled}>
        <TooltipTrigger
          as="button"
          type="button"
          class={cx("flex items-center size-6 justify-center transition-colors group disabled:cursor-not-allowed disabled:opacity-50", props.class)}
          onClick={props.onToggle}
          disabled={props.disabled}
        >
          <div
            class={cx(
              "size-1.5 rotate-45 border transition-colors",
              props.state.isActive
                ? "bg-primary"
                : "bg-transparent group-hover:border-foreground",
              props.state.hasTrack
                ? "border-primary"
                : "border-muted-foreground"
            )}
          />
        </TooltipTrigger>
        <TooltipContent>{props.state.isActive ? "Remove keyframe" : "Add keyframe"}</TooltipContent>
      </Tooltip>
    </Show>
  )
}
