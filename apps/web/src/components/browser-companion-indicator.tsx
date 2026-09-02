import { Show, createEffect } from "solid-js";
import { Cache, Computed, Geometry, Playback, getActiveEntity } from "@diffusionstudio/runtime";
import { useWorld } from "@diffusionstudio/koota-solid";

import { companionError, reportCompanionSemantic } from "@/lib/browser-companion";
import { useEngineContext } from "@/engine";
import { isBrowserCompanionRenderer } from "@/lib/companion-authority";

export function BrowserCompanionIndicator() {
  return (
    <Show when={isBrowserCompanionRenderer()}>
      <div class="fixed right-3 top-3 z-[90] flex items-center gap-2 rounded-md border border-border-strong bg-background/95 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-lg backdrop-blur">
        <span class="font-medium text-foreground">Browser companion</span>
        <span>Read-only · local-only</span>
        <span>Phase A media unavailable</span>
        <Show when={companionError()}><span class="text-destructive">{companionError()}</span></Show>
      </div>
    </Show>
  );
}

/** Semantic diagnostics only: never records keys, pointers, paths, or source text. */
export function BrowserCompanionSemanticReporter() {
  const world = useWorld();
  const engine = useEngineContext();
  let initialized = false;
  let lastPlaying = false;
  let lastTime = 0;

  createEffect(() => {
    engine.frame();
    if (!isBrowserCompanionRenderer()) return;
    const scene = getActiveEntity(world);
    if (!scene) return;
    const playing = scene.get(Playback)?.playing ?? false;
    const time = scene.get(Computed)?.localTimeInSeconds ?? 0;
    if (!initialized) {
      const children = scene.get(Cache)?.children ?? [];
      console.info("[browser-companion] runtime.ready", JSON.stringify({
        geometryNodes: world.query(Geometry).length,
        sceneChildren: children.length,
        keyframeTracks: children.reduce((count, child) => count + (child.get(Cache)?.keyframeTracks.length ?? 0), 0),
      }));
    }
    if (initialized) {
      if (playing !== lastPlaying) reportCompanionSemantic(playing ? "playback.play" : "playback.pause", { time });
      else if (!playing && Math.abs(time - lastTime) > 1 / 120) {
        reportCompanionSemantic("playback.scrub", { time });
      }
    }
    initialized = true;
    lastPlaying = playing;
    lastTime = time;
  });
  return null;
}
