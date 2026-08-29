/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo } from "solid-js";
import { Audio } from "@diffusionstudio/runtime";
import { authoredElement } from "@diffusionstudio/reconciler";
import { useWorld } from "@diffusionstudio/koota-solid";
import { useSelection } from "@/engine/hooks";
import { useMediaSelection } from "./selection";
import { editorSession } from "@/context/dapi/session";
import {
  analyzeClipForAutocut,
  applyAutocutToClip,
  autocutWouldChange,
  planAutocutTimeline,
  timelineStartSeconds,
} from "@/engine/autocut";
import { getEditHistory } from "@/engine/history";
import { toast } from "somoto";

import type { AudioAsset, VideoAsset } from "@diffusionstudio/assets";
import type { Entity } from "koota";

function isMediaClip(entity: Entity): boolean {
  const tag = authoredElement(entity)?.tag;
  return tag === "video" || tag === "audio" || entity.has(Audio);
}

export function useAutocut() {
  const world = useWorld();
  const { nodes } = useSelection();
  const { bound } = useMediaSelection();

  const clips = createMemo(() => {
    const selected = nodes().filter(isMediaClip);
    if (selected.length !== 1) return [];
    const entity = selected[0];
    const match = bound().find((entry) => entry.entity === entity);
    if (!match) return [];
    if (match.asset.type !== "VIDEO" && match.asset.type !== "AUDIO") return [];
    return [{ entity, asset: match.asset as VideoAsset | AudioAsset }];
  });

  const hasClip = () => clips().length === 1;

  const run = async () => {
    const [clip] = clips();
    if (!clip) {
      toast("Select one video or audio clip on the timeline.");
      return;
    }

    const projectDir = editorSession()?.project.dir();
    const history = getEditHistory(world);

    try {
      const result = await analyzeClipForAutocut(world, clip.entity, clip.asset, projectDir);
      if (!autocutWouldChange(result.removed)) {
        toast("Nothing to cut", { description: "No silences, fillers, or stutters were found in this clip." });
        return;
      }

      const specs = planAutocutTimeline(result.keep, timelineStartSeconds(world, clip.entity));
      if (specs.length === 0) {
        toast("Nothing to cut", { description: "Autocut would remove the entire clip." });
        return;
      }

      history.beginGesture();
      try {
        applyAutocutToClip(world, clip.entity, specs);
      } finally {
        history.endGesture();
      }

      toast("Autocut applied", {
        description: `${specs.length} clip${specs.length === 1 ? "" : "s"} on the timeline.`,
      });
    } catch (err) {
      toast.error("Autocut failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return { hasClip, run };
}
