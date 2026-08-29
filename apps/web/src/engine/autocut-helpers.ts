/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { AutocutClipSpec } from "@diffusionstudio/runtime/media/autocut";

/** Exactly one selected timeline clip tag — library binding not required. */
export function singleTimelineMediaTag(tags: ReadonlyArray<string | undefined>): "video" | "audio" | null {
  const media = tags.filter((tag): tag is "video" | "audio" => tag === "video" || tag === "audio");
  if (media.length !== 1) return null;
  return media[0];
}

/** `src` on a timeline `<video>` / `<audio>`, including path-based clips. */
export function mediaSrcFromAuthored(tag: string | undefined, src: unknown): string | null {
  if (tag !== "video" && tag !== "audio") return null;
  return typeof src === "string" && src.length > 0 ? src : null;
}

/** Timing props written on each trimmed copy after Autocut apply. */
export function trimmedClipTiming(spec: AutocutClipSpec) {
  return {
    start: spec.timelineStart,
    end: spec.timelineEnd,
    sourceIn: spec.sourceIn,
    sourceOut: spec.sourceOut,
  };
}
