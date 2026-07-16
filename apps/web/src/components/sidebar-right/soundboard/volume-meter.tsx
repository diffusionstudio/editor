/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createMemo, For, onCleanup, Show } from 'solid-js';
import { useVolumeMeter, type ChannelLevels } from '@/hooks/use-volume-meter';
import { cx } from '@/lib/cva';

const MIN_DB = -60;
const MAX_DB = 3;

/** Maps a linear amplitude (0–1+) to a meter percentage (0–100). */
function amplitudeToMeterPct(amplitude: number): number {
  if (amplitude <= 0) return 0;

  const db = 20 * Math.log10(amplitude);

  if (db <= MIN_DB) return 0;
  if (db >= MAX_DB) return 100;

  return ((db - MIN_DB) / (MAX_DB - MIN_DB)) * 100;
}

/**
 * Color stop thresholds (as percentage of meter height):
 *   0–60%   green
 *  60–85%   yellow
 *  85–100%  red
 */
const GREEN_END = 60;
const YELLOW_END = 80;

const SCALE_LABELS = ['0', '-3', '-6', '-12', '-24', 'dB'];

const MINOR_TICKS_PER_SEGMENT = 3;

type VolumeMeterProps = {
  audioNode?: GainNode;
};

export function VolumeMeter(props: VolumeMeterProps) {
  const meter = useVolumeMeter();

  createEffect(() => {
    if (props.audioNode) {
      meter.connect(props.audioNode);
    } else {
      meter.disconnect();
    }
  });

  onCleanup(() => meter.disconnect());

  return (
    <div class="flex gap-px w-5">
      <VerticalMeter channel={0} levels={meter.levels} class="rounded-l" />
      <VerticalMeter channel={1} levels={meter.levels} class="rounded-r" />
    </div>
  );
}

type VerticalMeterProps = {
  channel: number;
  levels: () => ChannelLevels[];
  class?: string;
};

function VerticalMeter(props: VerticalMeterProps) {
  const level = () => {
    const ch = props.levels()[props.channel];
    return ch ?? { rms: 0, peak: 0 };
  };

  const rmsPct = () => amplitudeToMeterPct(level().rms);
  const peakPct = () => amplitudeToMeterPct(level().peak);

  const indicatorOffset = () => `${peakPct()}%`;
  const indicatorClass = () => {
    const pct = peakPct();
    if (pct >= YELLOW_END + (100 - YELLOW_END) / 2) return "bg-meter-red";
    if (pct >= GREEN_END) return "bg-meter-yellow";
    return "bg-meter-green";
  };

  return (
    <div class={cx("h-full relative w-full overflow-clip", props.class)}>
      <div class="absolute inset-0 bg-input" />

      <div
        class="absolute inset-0"
        style={{ "clip-path": `inset(${100 - rmsPct()}% 0 0 0)` }}
      >
        <MeterSegments />
      </div>

      {/* Peak indicator line */}
      <Show when={peakPct() > 0.5}>
        <div
          class={cx("absolute inset-x-0 h-px", indicatorClass())}
          style={{ bottom: indicatorOffset() }}
        />
      </Show>
    </div>
  );
}

function MeterSegments() {
  return (
    <>
      {/* Green: bottom 60% */}
      <div
        class="absolute inset-x-0 bottom-0 bg-meter-green"
        style={{ height: `${GREEN_END}%` }}
      />
      {/* Yellow: 60–85% */}
      <div
        class="absolute inset-x-0 bg-meter-yellow"
        style={{
          bottom: `${GREEN_END}%`,
          height: `${YELLOW_END - GREEN_END}%`,
        }}
      />
      {/* Red: 85–100% */}
      <div
        class="absolute inset-x-0 top-0 bg-meter-red"
        style={{ height: `${100 - YELLOW_END}%` }}
      />
    </>
  );
}

/**
 * 0 dB (unity) sits at 50% (middle of the track).
 * Top = SLIDER_MAX_DB, bottom = SLIDER_MIN_DB.
 */
const SLIDER_MAX_DB = -MIN_DB;   // +60 dB at top (symmetric around 0)
const SLIDER_MIN_DB = MIN_DB;    // -60 dB at bottom

/** Maps a dB value to a slider percentage (0%=top, 100%=bottom). */
function dbToSliderPct(db: number): number {
  const clamped = Math.max(SLIDER_MIN_DB, Math.min(SLIDER_MAX_DB, db));
  return ((SLIDER_MAX_DB - clamped) / (SLIDER_MAX_DB - SLIDER_MIN_DB)) * 100;
}

/** Maps a slider percentage (0%=top, 100%=bottom) to a dB value. */
function sliderPctToDb(pct: number): number {
  const clamped = Math.max(0, Math.min(100, pct));
  return SLIDER_MAX_DB - (clamped / 100) * (SLIDER_MAX_DB - SLIDER_MIN_DB);
}

type VolumeControlProps = {
  volume: number;
  onVolumeChange(volume: number): void;
  disabled?: boolean;
};

export function VolumeControl(props: VolumeControlProps) {
  const segments = SCALE_LABELS.length - 1;
  const totalMinor = segments * (MINOR_TICKS_PER_SEGMENT + 1);

  const knobPct = createMemo(() => dbToSliderPct(props.volume));

  let trackRef!: HTMLDivElement;

  const handlePointerDown = (e: PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const update = (clientY: number) => {
      const rect = trackRef.getBoundingClientRect();
      const pct = ((clientY - rect.top) / rect.height) * 100;
      const db = sliderPctToDb(pct);
      props.onVolumeChange(db);
    };

    update(e.clientY);

    const onMove = (ev: PointerEvent) => update(ev.clientY);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      ref={trackRef}
      class="relative w-3 h-full mr-3 flex flex-col justify-between items-end"
      classList={{ 'opacity-50 pointer-events-none': props.disabled }}
      onPointerDown={handlePointerDown}
    >
      <For each={Array.from({ length: totalMinor + 1 }, (_, i) => i)}>
        {(i) => {
          const isMajor = i % (MINOR_TICKS_PER_SEGMENT + 1) === 0;

          return (
            <div
              class="h-px pointer-events-none"
              classList={{
                'bg-muted-foreground': isMajor,
                'bg-muted-foreground/70': !isMajor,
                'w-full': isMajor,
                'w-1/2': !isMajor,
              }}
            />
          );
        }}
      </For>
      <div
        class="w-5 -translate-y-1/2 h-2 flex justify-center items-center absolute -left-1 bg-foreground rounded-xs pointer-events-none"
        style={{ top: `${knobPct()}%` }}
      >
      </div>
    </div>
  );
}

export function MeterScale() {
  return (
    <div class="relative flex flex-col justify-between h-full ml-1">
      <For each={SCALE_LABELS}>
        {(label) => {
          const needsPad = !label.startsWith('-');
          return (
            <span class="text-xxs leading-none font-mono text-muted-foreground">
              {needsPad && <span class="invisible">-</span>}
              {label}
            </span>
          );
        }}
      </For>
    </div>
  );
}
