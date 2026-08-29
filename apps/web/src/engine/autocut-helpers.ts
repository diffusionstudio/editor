/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { AutocutClipSpec } from "@diffusionstudio/runtime/media/autocut";

/** Asset kinds the timeline treats as Autocut media clips. */
export function isAutocutAssetType(type: string | undefined): boolean {
  return type === "VIDEO" || type === "SEQUENCE" || type === "AUDIO";
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

/** Merges timeline/source trim onto an authored element's static props. */
export function mergeAuthoredTiming(
  props: Record<string, unknown>,
  spec: AutocutClipSpec,
): Record<string, unknown> {
  return { ...props, ...trimmedClipTiming(spec) };
}
