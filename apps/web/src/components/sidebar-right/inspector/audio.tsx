/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, onCleanup, Show, type JSX } from "solid-js";
import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";
import { ControlledTextField } from "@/components/ui/text-field";
import { Keyframe } from "@/components/ui/keyframe";
import { useVolumeMeter, type ChannelLevels } from "@/hooks/use-volume-meter";
import { cx } from "@/lib/cva";
import { useHas, useTrait, useWorld } from "@diffusionstudio/koota-solid";
import { AudioBusHandle, Computed, Muted, Soloed } from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { syncKeyframe } from "@/engine/keyframes";

import type { Entity } from "@diffusionstudio/koota";

const MIN_DB = -60;
const MAX_DB = 12;
const KNOB_MAX_ANGLE = 135;
const METER_MAX_DB = 3;
const METER_GREEN_END = 60;
const METER_YELLOW_END = 80;

function normalizeDb(value: number): number {
  if (!Number.isFinite(value)) return MIN_DB;
  return Math.max(MIN_DB, Math.min(MAX_DB, value));
}

function amplitudeToMeterPct(amplitude: number): number {
  if (amplitude <= 0) return 0;

  const db = 20 * Math.log10(amplitude);
  if (db <= MIN_DB) return 0;
  if (db >= METER_MAX_DB) return 100;

  return ((db - MIN_DB) / (METER_MAX_DB - MIN_DB)) * 100;
}

type HorizontalMeterProps = {
  channel: number;
  levels: () => ChannelLevels[];
  class?: string;
};

function HorizontalMeter(props: HorizontalMeterProps) {
  const level = () => {
    const channel = props.levels()[props.channel];
    return channel ?? { rms: 0, peak: 0 };
  };

  const rmsPct = () => amplitudeToMeterPct(level().rms);
  const peakPct = () => amplitudeToMeterPct(level().peak);

  const indicatorClass = () => {
    const pct = peakPct();
    if (pct >= METER_YELLOW_END + (100 - METER_YELLOW_END) / 2) return "bg-meter-red";
    if (pct >= METER_GREEN_END) return "bg-meter-yellow";
    return "bg-meter-green";
  };

  return (
    <div class={cx("relative flex-1 h-[2px] bg-input rounded-sm overflow-visible", props.class)}>
      <div
        class="absolute inset-y-0 left-0 bg-meter-green"
        style={{ width: `${METER_GREEN_END}%` }}
      />
      <div
        class="absolute inset-y-0 bg-meter-yellow"
        style={{
          left: `${METER_GREEN_END}%`,
          width: `${METER_YELLOW_END - METER_GREEN_END}%`,
        }}
      />
      <div
        class="absolute inset-y-0 right-0 bg-meter-red"
        style={{ width: `${100 - METER_YELLOW_END}%` }}
      />

      <div
        class="absolute inset-y-0 right-0 bg-input transition-none"
        style={{ width: `${100 - rmsPct()}%` }}
      />

      <Show when={peakPct() > 0.5}>
        <div
          class={cx("absolute top-1/2 -translate-y-1/2 w-px h-[6px]", indicatorClass())}
          style={{ left: `${peakPct()}%` }}
        />
      </Show>
    </div>
  );
}

type VolumeKnobProps = {
  minDb: number;
  maxDb: number;
  disabled?: boolean;
  volume: number;
  onVolumeChange(val: number): void;
};

function VolumeKnob(props: VolumeKnobProps) {
  const isDragging = { current: false };
  const knobRef = { current: undefined as HTMLDivElement | undefined };

  const ARC_RADIUS = 13;
  const ARC_CIRCUMFERENCE = 2 * Math.PI * ARC_RADIUS;

  const knobAngle = () => {
    const value = normalizeDb(props.volume);

    if (value >= 0) {
      const t = Math.min(1, value / props.maxDb);
      return t * KNOB_MAX_ANGLE;
    }

    const t = Math.min(1, Math.abs(value) / Math.abs(props.minDb));
    return -t * KNOB_MAX_ANGLE;
  };

  const knobArcAngle = () => {
    const angle = Math.abs(knobAngle());
    if (angle < 0.5) return 0;
    return angle;
  };

  const knobArcDasharray = () => {
    const length = (knobArcAngle() / 360) * ARC_CIRCUMFERENCE;
    return `${length} ${ARC_CIRCUMFERENCE}`;
  };

  const shouldFlipArc = () => knobAngle() < 0;

  const angleToDb = (angle: number) => {
    const clamped = Math.max(-KNOB_MAX_ANGLE, Math.min(KNOB_MAX_ANGLE, angle));

    if (clamped >= 0) {
      const t = clamped / KNOB_MAX_ANGLE;
      return t * props.maxDb;
    }

    const t = Math.abs(clamped) / KNOB_MAX_ANGLE;
    return -t * Math.abs(props.minDb);
  };

  const updateFromPointer = (clientX: number, clientY: number) => {
    const root = knobRef.current;
    if (!root) return;

    const rect = root.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let angle = (Math.atan2(clientY - centerY, clientX - centerX) * 180) / Math.PI + 90;
    if (angle > 180) angle -= 360;

    props.onVolumeChange(angleToDb(angle));
  };

  const handleWheel: JSX.EventHandler<HTMLDivElement, WheelEvent> = (e) => {
    if (props.disabled) return;

    e.preventDefault();
    const step = e.deltaY > 0 ? -1 : 1;
    props.onVolumeChange(props.volume + step);
  };

  const handleDragMove = (ev: PointerEvent) => {
    if (!isDragging.current || props.disabled) return;
    updateFromPointer(ev.clientX, ev.clientY);
  };

  const handleDragEnd = () => {
    if (!isDragging.current) return;

    isDragging.current = false;
    window.removeEventListener("pointermove", handleDragMove);
    window.removeEventListener("pointerup", handleDragEnd);
  };

  const handlePointerDown: JSX.EventHandler<HTMLDivElement, PointerEvent> = (e) => {
    if (props.disabled) return;

    e.preventDefault();
    isDragging.current = true;
    updateFromPointer(e.clientX, e.clientY);

    window.addEventListener("pointermove", handleDragMove);
    window.addEventListener("pointerup", handleDragEnd);
  };

  onCleanup(() => {
    window.removeEventListener("pointermove", handleDragMove);
    window.removeEventListener("pointerup", handleDragEnd);
    isDragging.current = false;
  });

  return (
    <div
      ref={(el) => {
        knobRef.current = el;
      }}
      class="flex-1 bg-input rounded-md h-full relative"
      classList={{ "opacity-50 pointer-events-none": props.disabled }}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
    >
      <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[28px] h-[28px] bg-muted rounded-full">
        <svg
          aria-hidden="true"
          viewBox="0 0 28 28"
          class="absolute inset-0 text-primary"
        >
          <g transform={shouldFlipArc() ? "translate(28 0) scale(-1 1)" : undefined}>
            <circle
              cx="14"
              cy="14"
              r={ARC_RADIUS}
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-dasharray={knobArcDasharray()}
              transform="rotate(-90 14 14)"
            />
          </g>
        </svg>
        <div class="absolute inset-[2px] rounded-full bg-muted" />
      </div>

      <div class="absolute left-1/2 top-1/2 w-[51px] h-[51px] -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none">
        <div class="flex-none" style={{ transform: `rotate(${knobAngle()}deg)` }}>
          <div class="relative w-9 h-9 text-foreground">
            <Icon name="vertical-knob-line" class="w-full h-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

type AudioSettingsProps = {
  selection: Entity[];
};

/**
 * The node's audio: its gain in decibels, mute and solo, and the live level
 * of its bus. `volume` and `muted` are props (0 dB is unity, so a volume
 * left there is unset); solo is the runtime's own tag with no JSX spelling,
 * written to the trait alone and gone on the next recompile, which is what a
 * monitoring toggle should be.
 */
export function AudioSettings(props: AudioSettingsProps) {
  const world = useWorld();
  const editor = useEditor();
  const meter = useVolumeMeter();
  const entity = () => props.selection[0]!;

  // Computed is written by the systems without change events.
  const volume = useDerived(() => entity().get(Computed)?.volume ?? 0);
  const muted = useHas(entity, Muted);
  const soloed = useHas(entity, Soloed);
  // The bus is spun up by the playback system once the node has audio, and
  // set back to null when its decoders are released.
  const audioBus = useTrait(entity, AudioBusHandle);

  const toggleMuted = () => {
    editor.editProperty(entity(), "muted", !muted());
  };

  const toggleSoloed = () => {
    if (soloed()) entity().remove(Soloed);
    else entity().add(Soloed);
  };

  createEffect(() => {
    const bus = audioBus();
    if (bus) {
      meter.connect(bus.getGain());
    } else {
      meter.disconnect();
    }
  });

  onCleanup(() => meter.disconnect());

  const handleVolumeChange = (value: number | undefined) => {
    if (value === undefined) return;
    // Whole decibels: the field and the knob both show the value rounded,
    // and a dragged knob would otherwise write a new fraction per frame.
    const next = Math.round(normalizeDb(value));
    editor.editProperty(entity(), "volume", next === 0 ? false : next);
    syncKeyframe(world, editor, entity(), "volume", next);
  };

  return (
    <PanelSection title="Audio">
      <ControlRow
        label="Volume"
        class="items-start"
        labelClass="text-xxs pt-1.5"
        contentClass="h-16"
      >
        <div class="flex h-full gap-2">
          <div class="flex-1 flex flex-col gap-2 h-full">
            <ControlledTextField
              value={Math.round(normalizeDb(volume()))}
              onNumber={handleVolumeChange}
              min={MIN_DB}
              max={MAX_DB}
              step={1}
              unit="dB"
              showSign
              autoSelect
              keyframe={<Keyframe target={entity()} property="volume" />}
            />

            <div class="h-7 flex gap-px rounded-md overflow-hidden shrink-0">
              <button
                type="button"
                class="group flex-1 h-7 px-0 rounded-none bg-input hover:bg-input flex items-center justify-center"
                classList={{ "bg-muted": muted() }}
                onClick={toggleMuted}
                title="Mute"
              >
                <div
                  class="group-hover:text-foreground"
                  classList={{
                    "text-foreground": muted(),
                    "text-muted-foreground": !muted(),
                  }}
                >
                  <Icon name="prop-mute" />
                </div>
              </button>
              <button
                type="button"
                class="group flex-1 h-7 px-0 rounded-none bg-input hover:bg-input flex items-center justify-center"
                classList={{ "bg-muted": soloed() }}
                onClick={toggleSoloed}
                title="Solo"
              >
                <div
                  class="group-hover:text-foreground"
                  classList={{
                    "text-foreground": soloed(),
                    "text-muted-foreground": !soloed(),
                  }}
                >
                  <Icon name="prop-solo" />
                </div>
              </button>
            </div>
          </div>

          <VolumeKnob
            volume={Math.round(normalizeDb(volume()))}
            minDb={MIN_DB}
            maxDb={MAX_DB}
            onVolumeChange={handleVolumeChange}
          />
        </div>
      </ControlRow>
      <Show when={audioBus()}>
        <ControlRow label="" class="my-3">
          <HorizontalMeter channel={0} levels={meter.levels} />
          <HorizontalMeter channel={1} levels={meter.levels} class="mt-1" />
        </ControlRow>
      </Show>
    </PanelSection>
  );
}
