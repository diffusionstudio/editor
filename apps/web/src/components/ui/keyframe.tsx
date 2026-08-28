/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show } from "solid-js";
import { useHas, useWorld } from "@diffusionstudio/koota/solid";
import { Cache, Source } from "@diffusionstudio/runtime";
import { cx } from "@/lib/cva";
import { useDerived, useEditor } from "@/engine/hooks";
import { findKeyframeAt, findKeyframeTrack, keyframeFrame, toggleKeyframe } from "@/engine/keyframes";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

import type { AnimatableProperty } from "@diffusionstudio/jsx";
import type { Entity } from "@diffusionstudio/koota";

type KeyframeProps = {
  target: Entity;
  property: AnimatableProperty;
  disabled?: boolean;
  class?: string;
};

export function Keyframe(props: KeyframeProps) {
  const world = useWorld();
  const editor = useEditor();

  const hasSource = useHas(() => props.target, Source);

  const state = useDerived(
    () => {
      const frame = keyframeFrame(props.target);
      if (frame === null) return { available: false, hasTrack: false, isActive: false };
      const track = findKeyframeTrack(world, props.target, props.property);
      const keyframes = track?.get(Cache)?.keyframes.length ?? 0;
      return {
        available: true,
        hasTrack: track !== null && keyframes > 0,
        isActive: track !== null && findKeyframeAt(track, frame) !== null,
      };
    },
    (a, b) => a.available === b.available && a.hasTrack === b.hasTrack && a.isActive === b.isActive,
  );

  const toggle = () => toggleKeyframe(world, editor, props.target, props.property);

  return (
    <Show when={hasSource() && state().available}>
      <Tooltip openDelay={600} disabled={props.disabled}>
        <TooltipTrigger
          as="button"
          type="button"
          class={cx("flex items-center size-6 justify-center transition-colors group disabled:cursor-not-allowed disabled:opacity-50", props.class)}
          onClick={toggle}
          disabled={props.disabled}
        >
          <div
            class={cx(
              "size-1.5 rotate-45 border transition-colors",
              state().isActive
                ? "bg-primary"
                : "bg-transparent group-hover:border-foreground",
              state().hasTrack
                ? "border-primary"
                : "border-muted-foreground"
            )}
          />
        </TooltipTrigger>
        <TooltipContent>{state().isActive ? "Remove keyframe" : "Add keyframe"}</TooltipContent>
      </Tooltip>
    </Show>
  )
}
