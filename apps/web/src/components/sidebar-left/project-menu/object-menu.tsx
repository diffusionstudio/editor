/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { useWorld } from "@diffusionstudio/koota-solid";
import { isGroupLike, isSequence } from "@diffusionstudio/runtime";
import {
  groupSelection,
  ungroupSelection,
  unwrapSequenceSelection,
  useSelection,
  wrapSelectionInScene,
  wrapSelectionInSequence,
} from "@/engine";
import {
  analyzeClipForAutocut,
  applyAutocutToClip,
  autocutWouldChange,
  isAutocutClip,
  planAutocutTimeline,
  timelineStartSeconds,
} from "@/engine/autocut";
import { getEditHistory } from "@/engine/history";
import { toast } from "somoto";

export function ObjectMenu() {
  const world = useWorld();
  const { nodes } = useSelection();
  const hasSelection = () => nodes().length > 0;

  const hasContainer = () => nodes().some((node) => isGroupLike(node) || isSequence(node));
  const hasSequence = () => nodes().some(isSequence);

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>AI actions</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-[196px]">
              <ObjectAiMenu />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => groupSelection(world)}
        >
          Group
          <DropdownMenuShortcut>⌘G</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasContainer()}
          onSelect={() => ungroupSelection(world)}
        >
          Ungroup
          <DropdownMenuShortcut>⇧⌘G</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => wrapSelectionInScene(world)}
        >
          Wrap in scene
          <DropdownMenuShortcut>⌘↩︎</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => wrapSelectionInSequence(world)}
        >
          Wrap in sequence
          <DropdownMenuShortcut>⌥⌘↩︎</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSequence()}
          onSelect={() => unwrapSequenceSelection(world)}
        >
          Unwrap sequence
          <DropdownMenuShortcut>⌥⇧⌘↩︎</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          Bring to front
          <DropdownMenuShortcut>]</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Bring forward
          <DropdownMenuShortcut>⌘]</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Send backward
          <DropdownMenuShortcut>⌘[</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Send to back
          <DropdownMenuShortcut>[</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          Insert at playhead
          <DropdownMenuShortcut>’</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Insert on new track
          <DropdownMenuShortcut>⇧’</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Insert on canvas
          <DropdownMenuShortcut>⌥’</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Align</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-[196px]">
              <ObjectAlignMenu />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Transform</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-[196px]">
              <ObjectTransformMenu />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          Set mask target
          <DropdownMenuShortcut>⌃⌥M</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          Reveal in assets
          <DropdownMenuShortcut>⇧⌘O</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Reveal in finder
          <DropdownMenuShortcut>⌥⌘O</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Replace media...
          <DropdownMenuShortcut>⌥O</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>Remove properties</DropdownMenuItem>
        <DropdownMenuItem>Remove effects</DropdownMenuItem>
        <DropdownMenuItem>Remove transitions</DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function ObjectAiMenu() {
  const world = useWorld();
  const { nodes } = useSelection();

  const canRemoveSilences = () => {
    const eligible = nodes().filter((entity) => isAutocutClip(world, entity));
    return eligible.length === 1;
  };

  const removeSilences = async () => {
    const eligible = nodes().filter((entity) => isAutocutClip(world, entity));
    const entity = eligible.length === 1 ? eligible[0] : null;
    if (!entity) return;

    const history = getEditHistory(world);

    try {
      const result = await analyzeClipForAutocut(world, entity);
      if (!autocutWouldChange(result.removed)) {
        toast("Nothing to cut", { description: "No silences, fillers, or stutters were found in this clip." });
        return;
      }

      const specs = planAutocutTimeline(result.keep, timelineStartSeconds(world, entity));
      if (specs.length === 0) {
        toast("Nothing to cut", { description: "Remove silences would remove the entire clip." });
        return;
      }

      history.beginGesture();
      try {
        applyAutocutToClip(world, entity, specs);
      } finally {
        history.endGesture();
      }

      toast("Silences removed", {
        description: `${specs.length} clip${specs.length === 1 ? "" : "s"} on the timeline.`,
      });
    } catch (err) {
      toast.error("Remove silences failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem>Remove background</DropdownMenuItem>
        <DropdownMenuItem>Upscale</DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem disabled={!canRemoveSilences()} onSelect={() => void removeSilences()}>
          Remove silences
        </DropdownMenuItem>
        <DropdownMenuItem>Lip sync</DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function ObjectTransformMenu() {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem>
          Scale
          <DropdownMenuShortcut>K</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          Flip horizontal
          <DropdownMenuShortcut>⇧H</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Flip vertical
          <DropdownMenuShortcut>⇧V</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>Rotate 180°</DropdownMenuItem>
        <DropdownMenuItem>Rotate 90° left</DropdownMenuItem>
        <DropdownMenuItem>Rotate 90° right</DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>Reset transform</DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function ObjectAlignMenu() {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem>
          Align left
          <DropdownMenuShortcut>⌥A</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Align horizontal centers
          <DropdownMenuShortcut>⌥H</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Align right
          <DropdownMenuShortcut>⌥D</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Align top
          <DropdownMenuShortcut>⌥W</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Align vertical centers
          <DropdownMenuShortcut>⌥V</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Align bottom
          <DropdownMenuShortcut>⌥S</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          Distribute horizontally
          <DropdownMenuShortcut>⌃⌥H</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Distribute vertically
          <DropdownMenuShortcut>⌃⌥V</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}
