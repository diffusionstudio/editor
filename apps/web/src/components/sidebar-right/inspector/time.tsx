/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, Show } from "solid-js";
import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import { IncrementDecrementControl } from "@/components/ui/increment-decrement-control";
import { PanelSection } from "@/components/ui/panel-section";
import { ControlledTextField } from "@/components/ui/text-field";
import { useEngine } from "@/context/engine";
import {
  useEntityState,
  useEntityTag,
  PaintType,
  computeTrimStart,
  computeTrimEnd,
  setComponent,
  removeComponent,
  isScene,
  isGroup,
  resolveSequentialOverlaps,
  useAssets,
  saveAsset,
} from "@/components/engine";
import { secondsToFrames } from "@/components/engine/utils/time";
import {
  Checkbox,
  CheckboxControl,
  CheckboxInput,
  CheckboxLabel,
} from "@/components/ui/checkbox";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { MenuIconButton } from "@/components/ui/menu-icon-button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { createStoredSignal } from "@/lib/store";
import { store } from "@/init";
import { hasComponent } from "bitecs";


type TimeAddon = "inOut" | "playbackRate";
type TimeAddons = Partial<Record<TimeAddon, boolean>>;

function formatAsTimecode(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00:00";

  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remaining = totalSeconds % 60;

  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${remaining.toString().padStart(2, "0")}`;
}

function parseTimeInput(value: string) {
  const input = value.trim();
  if (!input) return null;

  if (!input.includes(":")) {
    const seconds = Number.parseFloat(input);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return seconds;
  }

  const parts = input.split(":").map((part) => part.trim());
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (parts.some((part) => part.length === 0)) return null;

  const numbers = parts.map((part) => Number.parseFloat(part));
  if (numbers.some((part) => !Number.isFinite(part) || part < 0)) return null;

  if (parts.length === 2) {
    const [minutes, seconds] = numbers;
    return minutes * 60 + seconds;
  }

  const [hours, minutes, seconds] = numbers;
  return hours * 3600 + minutes * 60 + seconds;
}

type TimeSettingsProps = {
  selection: Set<number>;
};

export function TimeSettings(props: TimeSettingsProps) {
  const { world } = useEngine();
  const assets = useAssets(world);
  const c = world.components;
  const eid = () => props.selection.values().next().value!;

  const [addons, setAddons] = createStoredSignal(
    store.define<TimeAddons>("time.addons", {})
  );

  const playbackRate = useEntityState(c.PlaybackRate, eid, 1);
  const trimStart = useEntityState(c.Trim.start, eid, 0);
  const start = useEntityState(c.Computed.start, eid, 0);
  const end = useEntityState(c.Computed.end, eid, 0);
  const fillEids = useEntityState(c.Cache.fills, eid, []);

  const isContainer = createMemo(() => isScene(world, eid()) || isGroup(world, eid()));
  const hasTrim = useEntityTag(c.Trim, eid);

  const playbackRatePercent = createMemo(() => Math.round(playbackRate() * 100));

  const startSeconds = createMemo(() => start() / world.frameRate);
  const endSeconds = createMemo(() => end() / world.frameRate);
  const durationSeconds = createMemo(() => endSeconds() - startSeconds());

  const supportsPlaybackRate = createMemo(() => hasComponent(world, eid(), c.Geometry) && !isScene(world, eid()));

  const sequenceAsset = createMemo(() => {
    for (const fid of fillEids() ?? []) {
      if (c.Paint[fid] !== PaintType.SEQUENCE) continue;
      const id = c.AssetId[fid];
      if (!id) continue;
      const asset = assets.get(id);
      if (asset?.type === 'SEQUENCE') return asset;
    }
    return null;
  });

  const handleAddAddon = (addon: TimeAddon) => setAddons({ ...addons(), [addon]: true });
  const handleRemoveAddon = (addon: TimeAddon) => setAddons({ ...addons(), [addon]: false });

  // Apply a timing edit as one undo step, then trim/remove/split any sibling it
  // now overlaps inside a Sequential container (no-op elsewhere).
  const commitTimeChange = (label: string, mutate: () => void) => {
    world.history.transaction(label, () => {
      mutate();
      resolveSequentialOverlaps(world, [eid()]);
    });
  };

  const assignPlaybackRate = (newRate: number) => {
    const newDelay = Math.round(start() - trimStart() / newRate);

    commitTimeChange("Set speed", () => {
      setComponent(world, eid(), c.PlaybackRate, newRate);
      setComponent(world, eid(), c.Delay, newDelay);
    });
  };

  const handleInChange = (event: Event & { currentTarget: HTMLInputElement }) => {
    const parsed = parseTimeInput(event.currentTarget.value);
    if (parsed === null) return;

    const parsedFrame = secondsToFrames(parsed);
    const start = computeTrimStart(world, eid(), parsedFrame);
    commitTimeChange("Set in point", () => setComponent(world, eid(), c.Trim, { start }));
  };

  const handleOutChange = (event: Event & { currentTarget: HTMLInputElement }) => {
    const parsed = parseTimeInput(event.currentTarget.value);
    if (parsed === null) return;

    const parsedFrame = secondsToFrames(parsed);
    const end = computeTrimEnd(world, eid(), parsedFrame);
    commitTimeChange("Set out point", () => setComponent(world, eid(), c.Trim, { end }));
  };

  const handleLengthChange = (durationSec: number) => {
    const newEnd = start() + secondsToFrames(durationSec);

    const end = computeTrimEnd(world, eid(), newEnd);
    commitTimeChange("Set length", () => setComponent(world, eid(), c.Trim, { end }));
  }

  const toggleTrim = (checked: boolean) => {
    commitTimeChange("Toggle trim", () => {
      if (checked) {
        // Seed the explicit window with the current computed bounds so enabling
        // the trim doesn't visibly resize the container.
        const trimStart = computeTrimStart(world, eid(), start());
        const trimEnd = computeTrimEnd(world, eid(), end());
        setComponent(world, eid(), c.Trim, { start: trimStart, end: trimEnd });
      } else {
        removeComponent(world, eid(), c.Trim);
      }
    });
  };

  const handleFrameRateChange = (newRate: number) => {
    const asset = sequenceAsset();
    if (!asset) return;

    const clamped = Math.max(1, Math.min(240, Math.round(newRate)));
    if (clamped === asset.frameRate) return;

    // The persisted asset stores duration + fps; the frame count is implied.
    // Re-derive it so the new duration covers exactly the same frames.
    const frameCount = Math.max(1, Math.round(asset.duration * asset.frameRate));
    const newDurationInSeconds = frameCount / clamped;

    saveAsset(world, { ...asset, frameRate: clamped, duration: newDurationInSeconds });

    const newDuration = secondsToFrames(newDurationInSeconds);
    if ((c.Trim.end[eid()] ?? 0) > newDuration) {
      commitTimeChange("Set frame rate", () => setComponent(world, eid(), c.Trim, { end: newDuration }));
    }
  };

  return (
    <PanelSection
      title="Time"
      actions={
        <Show when={!addons().inOut || !addons().playbackRate}>
          <MenuIconButton
            tooltip="Add option"
            aria-label="Add time property"
            placement="bottom-end"
            class="text-muted-foreground"
            icon={<Icon name="plus-add" />}
          >
            <Show when={!addons().inOut}>
              <DropdownMenuItem onSelect={() => handleAddAddon("inOut")}>
                In &amp; Out
              </DropdownMenuItem>
            </Show>
            <Show when={!addons().playbackRate && supportsPlaybackRate()}>
              <DropdownMenuItem onSelect={() => handleAddAddon("playbackRate")}>
                Playback rate
              </DropdownMenuItem>
            </Show>
          </MenuIconButton>
        </Show>
      }
    >
      <ControlRow
        label="Length"
        contentClass="grid grid-cols-2 gap-2 min-w-0"
      >
        <ControlledTextField
          value={Math.round(durationSeconds() * 10) / 10}
          min={0}
          step={0.1}
          unit="s"
          autoSelect
          limitEvents
          onNumber={handleLengthChange}
        />
        <IncrementDecrementControl
          decrementLabel="Decrease length"
          incrementLabel="Increase length"
          onDecrement={() => handleLengthChange(Math.max(0.1, durationSeconds() - 0.1))}
          onIncrement={() => handleLengthChange(durationSeconds() + 0.1)}
        />
      </ControlRow>

      <Show when={supportsPlaybackRate() && addons().playbackRate}>
        <ContextMenu>
          <ContextMenuTrigger<typeof ControlRow>
            as={ControlRow}
            label="Speed"
            contentClass="grid grid-cols-2 gap-2 min-w-0"
          >
            <ControlledTextField
              value={playbackRatePercent()}
              min={1}
              step={5}
              unit="%"
              autoSelect
              limitEvents
              onNumber={(value) => assignPlaybackRate(value / 100)}
            />
            <IncrementDecrementControl
              decrementLabel="Decrease speed"
              incrementLabel="Increase speed"
              onDecrement={() => assignPlaybackRate(Math.max(1, Math.round(playbackRatePercent() - 10)) / 100)}
              onIncrement={() => assignPlaybackRate(Math.round(playbackRatePercent() + 10) / 100)}
            />
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => handleRemoveAddon("playbackRate")}>
              Remove row
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </Show>



      <Show when={addons().inOut}>
        <ContextMenu>
          <ContextMenuTrigger<typeof ControlRow>
            as={ControlRow}
            label="In & Out"
            contentClass="grid grid-cols-2 gap-2 min-w-0"
          >
            <ControlledTextField
              value={formatAsTimecode(startSeconds())}
              autoSelect
              onChange={handleInChange}
            />
            <ControlledTextField
              value={formatAsTimecode(endSeconds())}
              autoSelect
              onChange={handleOutChange}
            />
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => handleRemoveAddon("inOut")}>
              Remove row
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </Show>

      <Show when={sequenceAsset()}>
        {(asset) => (
          <ControlRow label="Frame Rate">
            <ControlledTextField
              value={Math.round(asset().frameRate)}
              min={1}
              max={240}
              step={1}
              unit="FPS"
              autoSelect
              limitEvents
              onNumber={handleFrameRateChange}
            />
          </ControlRow>
        )}
      </Show>

      <Show when={isContainer()}>
        <Checkbox
          checked={hasTrim()}
          onChange={toggleTrim}
          class="flex items-center"
        >
          <CheckboxInput />
          <CheckboxControl />
          <CheckboxLabel>
            Trim content
          </CheckboxLabel>
        </Checkbox>
      </Show>
    </PanelSection>
  );
}
