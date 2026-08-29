/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo } from "solid-js";
import { useWorld } from "@diffusionstudio/koota-solid";
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

import type { Entity } from "koota";

export function useAutocut() {
  const world = useWorld();
  const { videoNodes, audioNodes } = useMediaSelection();

  const clip = createMemo((): Entity | null => {
    const videos = videoNodes();
    const audios = audioNodes();
    if (videos.length === 1 && audios.length === 0) return videos[0];
    if (audios.length === 1 && videos.length === 0) return audios[0];
    return null;
  });

  const hasClip = () => clip() !== null;

  const run = async () => {
    const entity = clip();
    if (!entity) {
      toast("Select one video or audio clip on the timeline.");
      return;
    }

    const projectDir = editorSession()?.project.dir();
    const history = getEditHistory(world);

    try {
      const result = await analyzeClipForAutocut(world, entity, projectDir);
      if (!autocutWouldChange(result.removed)) {
        toast("Nothing to cut", { description: "No silences, fillers, or stutters were found in this clip." });
        return;
      }

      const specs = planAutocutTimeline(result.keep, timelineStartSeconds(world, entity));
      if (specs.length === 0) {
        toast("Nothing to cut", { description: "Autocut would remove the entire clip." });
        return;
      }

      history.beginGesture();
      try {
        applyAutocutToClip(world, entity, specs);
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
