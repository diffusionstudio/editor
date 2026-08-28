/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, createSignal, createEffect, onCleanup, Show } from "solid-js";
import { cubicBezier, spring } from "animejs";
import { PanelSection } from "@/components/ui/panel-section";
import { ControlRow } from "@/components/ui/control-group";
import { ControlledTextField } from "@/components/ui/text-field";
import { IncrementDecrementControl } from "@/components/ui/increment-decrement-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SegmentedIconTabs } from "@/components/ui/segmented-icon-tabs";
import { useTrait } from "@diffusionstudio/koota/solid";
import { Keyframe } from "@diffusionstudio/runtime";
import { useEditor } from "@/engine/hooks";
import {
  DEFAULT_SPRING,
  EASE_PRESETS,
  LINEAR,
  SPRING_PRESETS,
  easingPreset,
} from "./easing-types";

import type { EasingPreset } from "./easing-types";
import type { Entity } from "@diffusionstudio/koota";

type InterpolationSettingsProps = {
  selection: Entity[];
};

type InterpolationType = "hold" | "ease" | "spring";

function getEasingType(easing: string): InterpolationType {
  if (easing.startsWith("steps(")) return "hold";
  if (easing.startsWith("spring(")) return "spring";
  return "ease";
}

function parseSteps(easing: string): number {
  const match = easing.match(/steps\((\d+)\)/);
  return match ? parseInt(match[1], 10) : 1;
}

function parseBezier(
  easing: string,
): [number, number, number, number] {
  const match = easing.match(
    /cubicBezier\(([\d.-]+),([\d.-]+),([\d.-]+),([\d.-]+)\)/,
  );
  if (!match) return [0, 0, 1, 1]; // linear
  return [
    parseFloat(match[1]),
    parseFloat(match[2]),
    parseFloat(match[3]),
    parseFloat(match[4]),
  ];
}

function parseSpring(easing: string): { bounce: number; duration: number } {
  const match = easing.match(/spring\(([\d.-]+),([\d.-]+)\)/);
  if (!match) return { bounce: 0.5, duration: 500 };
  return { bounce: parseFloat(match[1]), duration: parseFloat(match[2]) };
}

function springToString(bounce: number, duration: number): string {
  return `spring(${bounce},${duration})`;
}

function bezierToString(points: [number, number, number, number]): string {
  const [x1, y1, x2, y2] = points;
  const isLinear = x1 === 0 && y1 === 0 && x2 === 1 && y2 === 1;
  return isLinear ? LINEAR.descriptor : `cubicBezier(${x1},${y1},${x2},${y2})`;
}

function formatBezier(points: [number, number, number, number]): string {
  return points.map((p) => p.toFixed(2)).join(", ");
}

/**
 * The easing of the selected keyframes: which segment shape they use and its
 * parameters. What a `<keyframe>` says is one `easing` prop, either a named
 * preset or the descriptor spelled out, so a curve dragged by hand travels as
 * `cubicBezier(...)` while the four ease and four spring presets travel as
 * their names. Linear is `<keyframe>`'s default and so is unset rather than
 * written.
 *
 * The panel shows the first selected keyframe and writes to all of them, the
 * way it always has: a multi-selection is being set to one easing, not being
 * asked what each of them says.
 */
export function InterpolationSettings(props: InterpolationSettingsProps) {
  const editor = useEditor();

  const keyframe = useTrait(() => props.selection[0], Keyframe);
  const currentEasing = () => keyframe()?.easing ?? LINEAR.descriptor;

  const activeTab = createMemo(() => getEasingType(currentEasing()));
  const bezierPoints = createMemo(() => parseBezier(currentEasing()));
  const stepsCount = createMemo(() => parseSteps(currentEasing()));
  const currentPreset = createMemo(
    () => EASE_PRESETS.find((p) => p.descriptor === currentEasing()) ?? null,
  );

  const springParams = createMemo(() => parseSpring(currentEasing()));
  // Matched on the numbers rather than on the descriptor, so a file spelling
  // one of them as `spring(0.50,628)` still reads as the preset it is.
  const currentSpringPreset = createMemo(() => {
    const { bounce, duration } = springParams();
    return SPRING_PRESETS.find((p) => {
      const preset = parseSpring(p.descriptor);
      return preset.bounce === bounce && preset.duration === duration;
    }) ?? null;
  });

  /**
   * Writes `descriptor` to every selected keyframe, named where the JSX has a
   * word for it. Linear is the prop's default, so it unsets instead.
   */
  const setEasingForAll = (descriptor: string) => {
    const named = easingPreset(descriptor);
    const value = named === LINEAR ? false : (named?.name ?? descriptor);
    for (const entity of props.selection) {
      editor.editProperty(entity, "easing", value);
    }
  };

  const setSpringBounce = (bounce: number) =>
    setEasingForAll(springToString(Math.max(BOUNCE_MIN, Math.min(BOUNCE_MAX, Math.round(bounce * 100) / 100)), springParams().duration));
  const setSpringDuration = (duration: number) =>
    setEasingForAll(springToString(springParams().bounce, Math.max(DURATION_MIN, Math.min(DURATION_MAX, Math.round(duration)))));

  const handlePresetChange = (preset: EasingPreset | null) => {
    if (!preset) return;
    setEasingForAll(preset.descriptor);
  };

  const handleTabChange = (tab: InterpolationType) => {
    if (tab === activeTab()) return;
    switch (tab) {
      case "hold":
        setEasingForAll("steps(1)");
        break;
      case "ease":
        setEasingForAll(LINEAR.descriptor);
        break;
      case "spring":
        setEasingForAll(DEFAULT_SPRING.descriptor);
        break;
    }
  };

  const setBezierPoints = (points: [number, number, number, number]) => {
    setEasingForAll(bezierToString(points));
  };

  const handleBezierInput = (raw: string) => {
    const parts = raw.split(",").map((s) => parseFloat(s.trim()));
    if (parts.length !== 4 || parts.some((p) => isNaN(p))) return;
    setBezierPoints(parts as [number, number, number, number]);
  };

  const TAB_ITEMS = [
    { value: "hold" as const, label: "Hold" },
    { value: "ease" as const, label: "Ease" },
    { value: "spring" as const, label: "Spring" },
  ];

  return (
    <PanelSection title="Interpolation">
      <SegmentedIconTabs
        value={activeTab}
        onChange={handleTabChange}
        items={TAB_ITEMS}
        class="w-full"
      />

      {/* Hold tab content */}
      <Show when={activeTab() === "hold"}>
        <StepCurve
          steps={stepsCount()}
          onStepsChange={(n) => setEasingForAll(`steps(${n})`)}
        />

        <div class="flex flex-col gap-2 pt-1">
          <ControlRow label="Steps" contentClass="flex gap-2">
            <ControlledTextField
              value={String(stepsCount())}
              autoSelect
              class="flex-1"
              onChange={(e: Event) => {
                const val = parseInt((e.currentTarget as HTMLInputElement).value, 10);
                if (!isNaN(val) && val >= 1) setEasingForAll(`steps(${val})`);
              }}
              limitEvents
            />
            <IncrementDecrementControl
              class="flex-1"
              onDecrement={() => {
                const n = stepsCount();
                if (n > 1) setEasingForAll(`steps(${n - 1})`);
              }}
              onIncrement={() => {
                setEasingForAll(`steps(${stepsCount() + 1})`);
              }}
            />
          </ControlRow>

          <ControlRow label="Preview">
            <InterpolationPreview easing={`steps(${stepsCount()})`} />
          </ControlRow>
        </div>
      </Show>

      {/* Ease tab content */}
      <Show when={activeTab() === "ease"}>
        <BezierCurve
          points={bezierPoints()}
          setPoints={setBezierPoints}
        />

        <div class="flex flex-col gap-2 pt-1">
          <ControlRow label="Ease">
            <Select<EasingPreset>
              value={currentPreset()}
              onChange={handlePresetChange}
              options={EASE_PRESETS}
              optionValue="name"
              optionTextValue="label"
              placeholder="Custom"
              itemComponent={(itemProps) => (
                <SelectItem item={itemProps.item}>
                  {itemProps.item.rawValue.label}
                </SelectItem>
              )}
            >
              <SelectTrigger>
                <SelectValue<EasingPreset> class="text-xs">
                  {(state) => state.selectedOption()?.label ?? "Custom"}
                </SelectValue>
              </SelectTrigger>
              <SelectPortal>
                <SelectContent />
              </SelectPortal>
            </Select>
          </ControlRow>

          <ControlRow label="Bezier">
            <ControlledTextField
              value={formatBezier(bezierPoints())}
              autoSelect
              onChange={(e: Event) =>
                handleBezierInput(
                  (e.currentTarget as HTMLInputElement).value,
                )
              }
              limitEvents
            />
          </ControlRow>

          <ControlRow label="Preview">
            <InterpolationPreview easing={currentEasing()} />
          </ControlRow>
        </div>
      </Show>

      {/* Spring tab content */}
      <Show when={activeTab() === "spring"}>
        <SpringCurve
          bounce={springParams().bounce}
          duration={springParams().duration}
          onBounceChange={setSpringBounce}
          onDurationChange={setSpringDuration}
        />

        <div class="flex flex-col gap-2 pt-1">
          <ControlRow label="Spring">
            <Select<EasingPreset>
              value={currentSpringPreset()}
              onChange={handlePresetChange}
              options={SPRING_PRESETS}
              optionValue="name"
              optionTextValue="label"
              placeholder="Custom"
              itemComponent={(itemProps) => (
                <SelectItem item={itemProps.item}>
                  {itemProps.item.rawValue.label}
                </SelectItem>
              )}
            >
              <SelectTrigger>
                <SelectValue<EasingPreset> class="text-xs">
                  {(state) => state.selectedOption()?.label ?? "Custom"}
                </SelectValue>
              </SelectTrigger>
              <SelectPortal>
                <SelectContent />
              </SelectPortal>
            </Select>
          </ControlRow>

          <ControlRow label="Bounce">
            <ControlledTextField
              value={String(springParams().bounce)}
              autoSelect
              sliderEnabled
              step={0.01}
              min={0}
              max={1}
              onNumber={setSpringBounce}
              limitEvents
            />
          </ControlRow>

          <ControlRow label="Duration">
            <ControlledTextField
              value={String(springParams().duration)}
              autoSelect
              sliderEnabled
              step={10}
              min={10}
              max={2000}
              onNumber={setSpringDuration}
              limitEvents
            />
          </ControlRow>

          <ControlRow label="Preview">
            <InterpolationPreview easing={currentEasing()} />
          </ControlRow>
        </div>
      </Show>
    </PanelSection>
  );
}

/* ---------- Bezier curve visualisation ---------- */

const BEZIER_SIZE = 236;
const BEZIER_PAD_X = 12;
const BEZIER_PAD_Y = 20;
const BEZIER_W = BEZIER_SIZE - BEZIER_PAD_X * 2;
const BEZIER_H = BEZIER_SIZE - BEZIER_PAD_Y * 2;
const HANDLE_RADIUS = 4;
const HANDLE_RADIUS_HOVER = 5.5;

function toSvg(nx: number, ny: number) {
  return {
    x: BEZIER_PAD_X + nx * BEZIER_W,
    y: BEZIER_SIZE - BEZIER_PAD_Y - ny * BEZIER_H,
  };
}

function fromSvg(sx: number, sy: number) {
  return {
    x: (sx - BEZIER_PAD_X) / BEZIER_W,
    y: (BEZIER_SIZE - BEZIER_PAD_Y - sy) / BEZIER_H,
  };
}

function clampX(v: number) {
  return Math.max(0, Math.min(1, v));
}

function round3(v: number) {
  return Math.round(v * 1000) / 1000;
}

type DragHandle = "p1" | "p2" | null;

type BezierCurveProps = {
  points: [number, number, number, number];
  setPoints: (points: [number, number, number, number]) => void;
};

function BezierCurve(props: BezierCurveProps) {
  let svgRef!: SVGSVGElement;
  const [dragging, setDragging] = createSignal<DragHandle>(null);
  const [hovered, setHovered] = createSignal<DragHandle>(null);

  const p0 = () => toSvg(0, 0);
  const p1 = () => toSvg(props.points[0], props.points[1]);
  const p2 = () => toSvg(props.points[2], props.points[3]);
  const p3 = () => toSvg(1, 1);

  function eventToNorm(e: PointerEvent) {
    const rect = svgRef.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * BEZIER_SIZE;
    const sy = ((e.clientY - rect.top) / rect.height) * BEZIER_SIZE;
    return fromSvg(sx, sy);
  }

  function handlePointerDown(handle: DragHandle, e: PointerEvent) {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDragging(handle);
  }

  function handlePointerMove(e: PointerEvent) {
    const handle = dragging();
    if (!handle) return;

    const norm = eventToNorm(e);
    const cx = round3(clampX(norm.x));
    const cy = round3(norm.y);

    const next = [...props.points] as [number, number, number, number];
    if (handle === "p1") {
      next[0] = cx;
      next[1] = cy;
    } else {
      next[2] = cx;
      next[3] = cy;
    }
    props.setPoints(next);
  }

  function handlePointerUp(e: PointerEvent) {
    if (!dragging()) return;
    (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    setDragging(null);
  }

  return (
    <div class="w-full aspect-square bg-input rounded-md relative overflow-hidden">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${BEZIER_SIZE} ${BEZIER_SIZE}`}
        class="w-full h-full"
        fill="none"
      >
        {/* Guide lines */}
        <line
          x1={0}
          y1={BEZIER_PAD_Y}
          x2={BEZIER_SIZE}
          y2={BEZIER_PAD_Y}
          stroke="currentColor"
          class="text-muted"
          stroke-opacity="0.4"
        />
        <line
          x1={0}
          y1={BEZIER_SIZE - BEZIER_PAD_Y}
          x2={BEZIER_SIZE}
          y2={BEZIER_SIZE - BEZIER_PAD_Y}
          stroke="currentColor"
          class="text-muted"
          stroke-opacity="0.4"
        />

        {/* Handle lines */}
        <line
          x1={p0().x}
          y1={p0().y}
          x2={p1().x}
          y2={p1().y}
          stroke="var(--color-primary)"
          stroke-width="1"
        />
        <line
          x1={p3().x}
          y1={p3().y}
          x2={p2().x}
          y2={p2().y}
          stroke="var(--color-primary)"
          stroke-width="1"
        />

        {/* Bezier curve */}
        <path
          d={`M ${p0().x} ${p0().y} C ${p1().x} ${p1().y}, ${p2().x} ${p2().y}, ${p3().x} ${p3().y}`}
          stroke="var(--color-primary)"
          stroke-width="2"
        />

        {/* Endpoint diamonds */}
        <rect
          x={p0().x - 4}
          y={p0().y - 4}
          width="8"
          height="8"
          rx="2"
          fill="var(--color-primary)"
          transform={`rotate(45 ${p0().x} ${p0().y})`}
        />
        <rect
          x={p3().x - 4}
          y={p3().y - 4}
          width="8"
          height="8"
          rx="2"
          fill="var(--color-primary)"
          transform={`rotate(45 ${p3().x} ${p3().y})`}
        />

        {/* Handle knob P1 (bottom-left control point) */}
        <circle
          cx={p1().x}
          cy={p1().y}
          r={hovered() === "p1" || dragging() === "p1" ? HANDLE_RADIUS_HOVER : HANDLE_RADIUS}
          fill="var(--color-primary)"
          classList={{ "cursor-grabbing": dragging() === "p1" }}
          onPointerEnter={() => setHovered("p1")}
          onPointerLeave={() => setHovered(null)}
          onPointerDown={[handlePointerDown, "p1"]}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />

        {/* Handle knob P2 (top-right control point) */}
        <circle
          cx={p2().x}
          cy={p2().y}
          r={hovered() === "p2" || dragging() === "p2" ? HANDLE_RADIUS_HOVER : HANDLE_RADIUS}
          fill="var(--color-primary)"
          classList={{ "cursor-grabbing": dragging() === "p2" }}
          onPointerEnter={() => setHovered("p2")}
          onPointerLeave={() => setHovered(null)}
          onPointerDown={[handlePointerDown, "p2"]}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </svg>
    </div>
  );
}

/* ---------- Interpolation preview ---------- */

const PREVIEW_DURATION = 1000;
const KNOB_SIZE = 8;

function InterpolationPreview(props: { easing: string }) {
  let trackRef!: HTMLDivElement;
  const [progress, setProgress] = createSignal(0);
  const [trackWidth, setTrackWidth] = createSignal(160);

  let easingFn: (t: number) => number = (t) => t;
  createEffect(() => {
    const e = props.easing;
    if (e.startsWith("steps(")) {
      const n = parseSteps(e);
      easingFn = (t) => Math.ceil(t * n) / n;
    } else if (e.startsWith("spring(")) {
      const { bounce, duration } = parseSpring(e);
      const s = spring({ bounce, duration });
      easingFn = (t: number) => s.ease(t);
    } else {
      const [x1, y1, x2, y2] = parseBezier(e);
      easingFn = cubicBezier(x1, y1, x2, y2);
    }
  });

  createEffect(() => {
    if (trackRef) setTrackWidth(trackRef.clientWidth);
    const ro = new ResizeObserver(() => {
      if (trackRef) setTrackWidth(trackRef.clientWidth);
    });
    ro.observe(trackRef);
    onCleanup(() => ro.disconnect());
  });

  let raf: number | undefined;
  let startTime: number | undefined;

  function tick(now: number) {
    if (startTime === undefined) startTime = now;
    const elapsed = now - startTime;
    const cycle = PREVIEW_DURATION * 2;
    const t = elapsed % cycle;

    if (t < PREVIEW_DURATION) {
      setProgress(easingFn(t / PREVIEW_DURATION));
    } else {
      setProgress(easingFn(1 - (t - PREVIEW_DURATION) / PREVIEW_DURATION));
    }

    raf = requestAnimationFrame(tick);
  }

  raf = requestAnimationFrame(tick);

  onCleanup(() => {
    if (raf !== undefined) cancelAnimationFrame(raf);
  });

  const PAD = 8;

  return (
    <div class="bg-input h-7 rounded-md relative overflow-hidden" ref={(el) => (trackRef = el)}>
      <div
        class="absolute top-1/2 -translate-y-1/2 rounded-full bg-muted-foreground"
        style={{
          width: `${KNOB_SIZE}px`,
          height: `${KNOB_SIZE}px`,
          left: `${PAD + progress() * (trackWidth() - 2 * PAD - KNOB_SIZE)}px`,
        }}
      />
    </div>
  );
}

/* ---------- Spring curve visualisation ---------- */

const SPRING_W = BEZIER_SIZE;
const SPRING_H = BEZIER_SIZE;
const SPRING_PAD = 20;
const SPRING_INNER_W = SPRING_W - SPRING_PAD * 2;
const SPRING_INNER_H = SPRING_H - SPRING_PAD * 2;

const DURATION_MIN = 10;
const DURATION_MAX = 2000;
const BOUNCE_MIN = 0;
const BOUNCE_MAX = 1;

const PILL_THICK = 7;
const PILL_LONG = 16;

type SpringCurveProps = {
  bounce: number;
  duration: number;
  onBounceChange: (bounce: number) => void;
  onDurationChange: (duration: number) => void;
};

function SpringCurve(props: SpringCurveProps) {
  let svgRef!: SVGSVGElement;
  const [dragging, setDragging] = createSignal<"duration" | "bounce" | null>(null);

  // Sample the curve via animejs spring
  const curveData = createMemo(() => {
    const s = spring({ bounce: props.bounce, duration: props.duration });
    // More oscillations at high bounce — scale samples to avoid aliasing
    const numSamples = Math.round(64 + props.bounce * 192);
    const samples: { t: number; v: number }[] = [];
    let yMin = Infinity;
    let yMax = -Infinity;

    for (let i = 0; i <= numSamples; i++) {
      const t = i / numSamples;
      const v = s.ease(t);
      samples.push({ t, v });
      yMin = Math.min(yMin, v);
      yMax = Math.max(yMax, v);
    }

    const above = yMax - 1;
    const below = 1 - yMin;
    const span = Math.max(above, below, 0.05) * 1.05;
    return { samples, yLo: 1 - span, yHi: 1 + span };
  });

  const toX = (t: number) => SPRING_PAD + t * (SPRING_W - SPRING_PAD);
  const toY = (v: number) => {
    const { yLo, yHi } = curveData();
    return SPRING_PAD + ((yHi - v) / (yHi - yLo)) * SPRING_INNER_H;
  };

  const buildPath = createMemo(() => {
    const { samples } = curveData();
    if (samples.length < 2) return "";

    const pts = samples.map((s) => ({ x: toX(s.t), y: toY(s.v) }));
    const n = pts.length;

    // Catmull-Rom → cubic bezier conversion (alpha = 0, uniform parameterisation)
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const p0 = pts[Math.max(i - 1, 0)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(i + 2, n - 1)];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  });

  // Duration pill: linear map [DURATION_MIN..DURATION_MAX] → x
  const durationX = createMemo(() => {
    const norm = (props.duration - DURATION_MIN) / (DURATION_MAX - DURATION_MIN);
    return SPRING_PAD + norm * SPRING_INNER_W;
  });

  // Bounce pill: linear map [BOUNCE_MAX..BOUNCE_MIN] → y (inverted: top = max bounce)
  const bounceY = createMemo(() => {
    const norm = (props.bounce - BOUNCE_MIN) / (BOUNCE_MAX - BOUNCE_MIN);
    return SPRING_PAD + (1 - norm) * SPRING_INNER_H;
  });

  function eventToSvg(e: PointerEvent) {
    const rect = svgRef.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * SPRING_W,
      y: ((e.clientY - rect.top) / rect.height) * SPRING_H,
    };
  }

  function handlePointerDown(knob: "duration" | "bounce", e: PointerEvent) {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDragging(knob);
  }

  function handlePointerMove(e: PointerEvent) {
    const d = dragging();
    if (!d) return;
    const svg = eventToSvg(e);

    if (d === "duration") {
      const norm = Math.max(0, Math.min(1, (svg.x - SPRING_PAD) / SPRING_INNER_W));
      props.onDurationChange(Math.round(DURATION_MIN + norm * (DURATION_MAX - DURATION_MIN)));
    } else {
      const norm = 1 - Math.max(0, Math.min(1, (svg.y - SPRING_PAD) / SPRING_INNER_H));
      props.onBounceChange(Math.round(norm * 100) / 100);
    }
  }

  function handlePointerUp(e: PointerEvent) {
    if (!dragging()) return;
    (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    setDragging(null);
  }

  return (
    <div
      class="w-full aspect-square bg-input rounded-md relative overflow-hidden"
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SPRING_W} ${SPRING_H}`}
        class="w-full h-full"
        fill="none"
        preserveAspectRatio="none"
      >
        {/* 4 inset corner diamonds defining the mapping range */}
        {[
          [SPRING_PAD, SPRING_PAD],
          [SPRING_PAD + SPRING_INNER_W, SPRING_PAD],
          [SPRING_PAD, SPRING_PAD + SPRING_INNER_H],
          [SPRING_PAD + SPRING_INNER_W, SPRING_PAD + SPRING_INNER_H],
        ].map(([cx, cy]) => (
          <circle
            cx={cx}
            cy={cy}
            r="2"
            fill="var(--muted-foreground)"
          />
        ))}

        {/* Duration handle guide line (vertical, full height) */}
        <line
          x1={durationX()}
          y1={0}
          x2={durationX()}
          y2={SPRING_H}
          stroke="currentColor"
          class="text-muted"
          stroke-opacity="0.4"
        />

        {/* Bounce handle guide line (horizontal, full width) */}
        <line
          x1={0}
          y1={bounceY()}
          x2={SPRING_W}
          y2={bounceY()}
          stroke="currentColor"
          class="text-muted"
          stroke-opacity="0.4"
        />

        {/* Spring response curve */}
        <path
          d={buildPath()}
          stroke="var(--color-primary)"
          stroke-width="2"
          fill="none"
        />

        {/* Duration pill (horizontal drag) — vertical bar */}
        <rect
          x={durationX() - PILL_THICK / 2}
          y={SPRING_H / 2 - PILL_LONG / 2}
          width={PILL_THICK}
          height={PILL_LONG}
          rx={PILL_THICK / 2}
          fill="white"
          stroke="var(--color-input)"
          stroke-width="2"
          class={dragging() === "duration" ? "cursor-grabbing" : "cursor-ew-resize"}
          onPointerDown={[handlePointerDown, "duration"]}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />

        {/* Bounce pill (vertical drag) — horizontal bar */}
        <rect
          x={SPRING_W / 2 - PILL_LONG / 2}
          y={bounceY() - PILL_THICK / 2}
          width={PILL_LONG}
          height={PILL_THICK}
          rx={PILL_THICK / 2}
          fill="white"
          stroke="var(--color-input)"
          stroke-width="2"
          class={dragging() === "bounce" ? "cursor-grabbing" : "cursor-ns-resize"}
          onPointerDown={[handlePointerDown, "bounce"]}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </svg>
    </div>
  );
}

/* ---------- Step curve visualisation ---------- */

const STEP_KNOB_W = 16;
const STEP_KNOB_H = 8;
const STEP_MAX = 20;

type StepCurveProps = {
  steps: number;
  onStepsChange: (steps: number) => void;
};

function StepCurve(props: StepCurveProps) {
  let svgRef!: SVGSVGElement;
  const [dragging, setDragging] = createSignal(false);

  const buildPath = () => {
    const n = props.steps;
    const parts: string[] = [];

    const x0 = BEZIER_PAD_X;
    const y0 = BEZIER_SIZE - BEZIER_PAD_Y;
    parts.push(`M ${x0} ${y0}`);

    for (let i = 0; i < n; i++) {
      const xEnd = BEZIER_PAD_X + ((i + 1) / n) * BEZIER_W;
      const yHold = BEZIER_SIZE - BEZIER_PAD_Y - (i / n) * BEZIER_H;
      const yNext = BEZIER_SIZE - BEZIER_PAD_Y - ((i + 1) / n) * BEZIER_H;

      parts.push(`L ${xEnd} ${yHold}`);
      parts.push(`L ${xEnd} ${yNext}`);
    }

    return parts.join(" ");
  };

  // Linear slider: steps=1 at bottom, steps=STEP_MAX at top
  const stepsToY = (steps: number) =>
    BEZIER_SIZE - BEZIER_PAD_Y - ((steps - 1) / (STEP_MAX - 1)) * BEZIER_H;

  const knobX = () => BEZIER_SIZE / 2;
  const knobY = () => stepsToY(props.steps);
  const guideLine = () => knobY();

  function eventToSteps(e: PointerEvent) {
    const rect = svgRef.getBoundingClientRect();
    const sy = ((e.clientY - rect.top) / rect.height) * BEZIER_SIZE;
    const t = (BEZIER_SIZE - BEZIER_PAD_Y - sy) / BEZIER_H;
    return Math.max(1, Math.min(STEP_MAX, Math.round(t * (STEP_MAX - 1) + 1)));
  }

  function handlePointerDown(e: PointerEvent) {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDragging(true);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!dragging()) return;
    const newSteps = eventToSteps(e);
    if (newSteps !== props.steps) {
      props.onStepsChange(newSteps);
    }
  }

  function handlePointerUp(e: PointerEvent) {
    if (!dragging()) return;
    (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    setDragging(false);
  }

  return (
    <div class="w-full aspect-square bg-input rounded-md relative overflow-hidden">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${BEZIER_SIZE} ${BEZIER_SIZE}`}
        class="w-full h-full"
        fill="none"
      >
        {/* Guide lines */}
        <line
          x1={0}
          y1={BEZIER_PAD_Y}
          x2={BEZIER_SIZE}
          y2={BEZIER_PAD_Y}
          stroke="currentColor"
          class="text-muted"
          stroke-opacity="0.4"
        />
        <line
          x1={0}
          y1={BEZIER_SIZE - BEZIER_PAD_Y}
          x2={BEZIER_SIZE}
          y2={BEZIER_SIZE - BEZIER_PAD_Y}
          stroke="currentColor"
          class="text-muted"
          stroke-opacity="0.4"
        />
        {/* Dynamic guide line at step level */}
        <line
          x1={BEZIER_PAD_X}
          y1={guideLine()}
          x2={BEZIER_SIZE - BEZIER_PAD_X}
          y2={guideLine()}
          stroke="currentColor"
          class="text-border"
          stroke-opacity="0.4"
        />

        {/* Step curve */}
        <path
          d={buildPath()}
          stroke="var(--color-primary)"
          stroke-width="2"
        />

        {/* Endpoint diamonds */}
        <rect
          x={BEZIER_PAD_X - 4}
          y={BEZIER_SIZE - BEZIER_PAD_Y - 4}
          width="8"
          height="8"
          rx="2"
          fill="var(--color-primary)"
          transform={`rotate(45 ${BEZIER_PAD_X} ${BEZIER_SIZE - BEZIER_PAD_Y})`}
        />
        <rect
          x={BEZIER_PAD_X + BEZIER_W - 4}
          y={BEZIER_PAD_Y - 4}
          width="8"
          height="8"
          rx="2"
          fill="var(--color-primary)"
          transform={`rotate(45 ${BEZIER_PAD_X + BEZIER_W} ${BEZIER_PAD_Y})`}
        />

        {/* Draggable knob — pill shape */}
        <rect
          x={knobX() - STEP_KNOB_W / 2}
          y={knobY() - STEP_KNOB_H / 2}
          width={STEP_KNOB_W}
          height={STEP_KNOB_H}
          rx={STEP_KNOB_H / 2}
          fill="white"
          stroke="var(--color-input)"
          stroke-width="2"
          class={dragging() ? "cursor-grabbing" : "cursor-grab"}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </svg>
    </div>
  );
}

