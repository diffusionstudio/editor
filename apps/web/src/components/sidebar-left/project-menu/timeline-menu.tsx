/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useWorld } from "@diffusionstudio/koota-solid";
import { Sequential } from "@diffusionstudio/runtime";
import { toast } from "somoto";
import { magneticTrackMode, setMagneticTrackEnabled } from "@/engine/timeline/magnetic-track";

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

export function TimelineMenu() {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem>Scene settings...</DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Captions</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-[196px]">
              <TimelineCaptionsMenu />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          Select nearest
          <DropdownMenuShortcut>⌃V</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Select</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-[236px]">
              <TimelineSelectMenu />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          Split at playhead
          <DropdownMenuShortcut>⌘B</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Track</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-[196px]">
              <TimelineTrackMenu />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Clip</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-[212px]">
              <TimelineClipMenu />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Audio</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-[196px]">
              <TimelineAudioMenu />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          Add marker
          <DropdownMenuShortcut>M</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Mark in / clear in
          <DropdownMenuShortcut>I</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Mark out / clear out
          <DropdownMenuShortcut>O</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Clear all markers
          <DropdownMenuShortcut>⌥M</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          Add transition to both
          <DropdownMenuShortcut>⌘T</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Add video transition
          <DropdownMenuShortcut>⌥T</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Add audio transition
          <DropdownMenuShortcut>⇧T</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          Toggle keyframes
          <DropdownMenuShortcut>U</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function TimelineSelectMenu() {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem>Select videos</DropdownMenuItem>
        <DropdownMenuItem>Select audio</DropdownMenuItem>
        <DropdownMenuItem>Select texts</DropdownMenuItem>
        <DropdownMenuItem>Select images</DropdownMenuItem>
        <DropdownMenuItem>Select captions</DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          Select forward on track
          <DropdownMenuShortcut>Y</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Select forward on all tracks
          <DropdownMenuShortcut>⌥Y</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          Select backward on track
          <DropdownMenuShortcut>⌘Y</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Select backward on all tracks
          <DropdownMenuShortcut>⌥⌘Y</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          Select next
          <DropdownMenuShortcut>⌥⌘→</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Select previous
          <DropdownMenuShortcut>⌥⌘←</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Select above
          <DropdownMenuShortcut>⌥⌘↓</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Select below
          <DropdownMenuShortcut>⌥⌘↑</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function TimelineCaptionsMenu() {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem>Generate captions...</DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>Change caption preset...</DropdownMenuItem>
        <DropdownMenuItem>Change caption language...</DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>Export captions...</DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function TimelineClipMenu() {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem>
          Change clip speed
          <DropdownMenuShortcut>R</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>Reset clip speed</DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          Enable/disable clip
          <DropdownMenuShortcut>D</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function TimelineTrackMenu() {
  const world = useWorld();
  const toggleMagneticTrack = () => {
    const track = world.query(Sequential).find((track) => magneticTrackMode(track));
    if (track) setMagneticTrackEnabled(world, track, magneticTrackMode(track) !== "on");
    else toast.info("請先在時間軸右鍵指定磁性主軌");
  };
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem>
          Enable/disable track
          <DropdownMenuShortcut>D</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>Mute/unmute track</DropdownMenuItem>
        <DropdownMenuItem>Toggle track solo</DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={toggleMagneticTrack}>切換磁性主軌</DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function TimelineAudioMenu() {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem>
          Mute/unmute audio
          <DropdownMenuShortcut>⌥M</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>Increase audio by 1 dB</DropdownMenuItem>
        <DropdownMenuItem>Decrease audio by 1 dB</DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>Increase audio by 3 dB</DropdownMenuItem>
        <DropdownMenuItem>Decrease audio by 3 dB</DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}
