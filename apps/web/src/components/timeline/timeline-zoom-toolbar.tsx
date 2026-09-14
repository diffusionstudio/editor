/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The timeline's zoom control: a floating pill over the canvas with
 * out/slider/in and a Fit button. Drag the `::` grip to move it anywhere —
 * position is persisted per user (see `store.define`).
 *
 * While the thumb is being dragged, the slider position is held in a local
 * signal so it follows the pointer pointer-synchronously — the scene's zoom
 * is sampled once a frame (see `useDerived`), which is fine for a click but
 * makes a controlled slider feel laggy under a drag. The zoom writes are
 * coalesced to one per frame; only the drag's end reports to the file.
 */

import { Show, createMemo, createSignal, onCleanup } from 'solid-js';
import { useWorld } from '@diffusionstudio/koota-solid';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Icon } from '@/components/ui/icon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Slider, SliderFill, SliderThumb, SliderTrack } from '@/components/ui/slider';
import { useTimeline } from '@/context/timeline';
import { useLayout } from '@/context/layout';
import { useDerived } from '@/engine/hooks';
import { store } from '@/init';
import { clamp } from '@/utils';
import { createStoredSignal } from '@/lib/store';
import {
	DEFAULT_TIMELINE_RESOLUTION,
	TIMELINE_RESOLUTION_RANGE,
	getResolution,
	getTimelineScene,
} from '@/engine/timeline';

const LOG_MIN = Math.log(TIMELINE_RESOLUTION_RANGE[0]);
const LOG_SPAN = Math.log(TIMELINE_RESOLUTION_RANGE[1]) - LOG_MIN;

/** A zoom level (pixels per frame) as the slider's 0..1 position. */
const zoomToSlider = (resolution: number): number => {
	if (resolution <= 0) return 0.5;
	return clamp01((Math.log(resolution) - LOG_MIN) / LOG_SPAN);
};

/** A slider position as a zoom level (pixels per frame). */
const sliderToZoom = (fraction: number): number => {
	return Math.exp(LOG_MIN + clamp01(fraction) * LOG_SPAN);
};

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

type ToolbarPosition = { right: number; bottom: number };

const DEFAULT_POSITION: ToolbarPosition = { right: 8, bottom: 8 };

export function TimelineZoomToolbar() {
	const world = useWorld();
	const timeline = useTimeline();
	const { timelineMinimized } = useLayout();

	// Where the pill floats, in px from the container's right/bottom edges.
	// Dragging updates a draft; the stored value is only written on release.
	const [savedPosition, setSavedPosition] = createStoredSignal(
		store.define<ToolbarPosition>('timeline.zoomToolbarPosition', DEFAULT_POSITION),
	);
	const [draftPosition, setDraftPosition] = createSignal<ToolbarPosition | null>(null);
	const position = createMemo(() => draftPosition() ?? savedPosition());

	// Sampled once a frame so the control always reflects where the timeline
	// is looking, however it got there (wheel, restore from file, the slider).
	const resolution = useDerived(() => {
		const scene = getTimelineScene(world);
		return scene === null ? 0 : getResolution(world, scene);
	});

	// While the thumb is being dragged, the thumb's own position; null means
	// the slider follows the scene.
	const [draft, setDraft] = createSignal<number | null>(null);

	const zoomPercent = createMemo(() => {
		const res = resolution();
		return res === 0 ? 100 : Math.round((res / DEFAULT_TIMELINE_RESOLUTION) * 100);
	});

	const sliderValue = createMemo(() => {
		const d = draft();
		if (d !== null) return d;
		const res = resolution();
		return res === 0 ? 0.5 : zoomToSlider(res);
	});

	// A pointermove writes the store at whatever rate it arrives at; coalesce
	// to one zoom write per frame while the thumb still tracks the pointer.
	let pendingZoom: number | null = null;
	let rafPending = 0;
	const scheduleZoomLive = (resolution: number): void => {
		pendingZoom = resolution;
		if (rafPending) return;
		rafPending = requestAnimationFrame(() => {
			rafPending = 0;
			const next = pendingZoom;
			pendingZoom = null;
			if (next !== null) timeline.zoomToLive(next);
		});
	};

	const handleValueChange = ([value]: number[]): void => {
		const next = clamp01(value);
		setDraft(next);
		scheduleZoomLive(sliderToZoom(next));
	};

	const handleValueChangeEnd = ([value]: number[]): void => {
		if (rafPending) {
			cancelAnimationFrame(rafPending);
			rafPending = 0;
			pendingZoom = null;
		}
		setDraft(null);
		timeline.zoomTo(sliderToZoom(clamp01(value)));
	};

	// --- Drag-to-move -------------------------------------------------------

	const [dragging, setDragging] = createSignal(false);
	let pillEl: HTMLDivElement | undefined;
	let dragStart: {
		startX: number;
		startY: number;
		origin: ToolbarPosition;
		maxRight: number;
		maxBottom: number;
	} | null = null;

	const handleGripMove = (event: PointerEvent): void => {
		if (!dragStart) return;
		const dx = event.clientX - dragStart.startX;
		const dy = event.clientY - dragStart.startY;
		setDraftPosition({
			right: clamp(dragStart.origin.right - dx, 0, dragStart.maxRight),
			bottom: clamp(dragStart.origin.bottom - dy, 0, dragStart.maxBottom),
		});
	};

	const handleGripUp = (): void => {
		if (!dragStart) return;
		document.removeEventListener('pointermove', handleGripMove);
		document.removeEventListener('pointerup', handleGripUp);

		const final = draftPosition();
		if (final) setSavedPosition(final);
		setDraftPosition(null);
		dragStart = null;
		setDragging(false);
	};

	const handleGripDown = (event: PointerEvent): void => {
		event.preventDefault();
		event.stopPropagation();
		if (dragStart !== null || !pillEl) return;

		const container = pillEl.parentElement;
		if (!container) return;
		const pillRect = pillEl.getBoundingClientRect();
		const containerRect = container.getBoundingClientRect();

		dragStart = {
			startX: event.clientX,
			startY: event.clientY,
			origin: position(),
			maxRight: Math.max(0, containerRect.width - pillRect.width),
			maxBottom: Math.max(0, containerRect.height - pillRect.height),
		};
		setDragging(true);

		document.addEventListener('pointermove', handleGripMove);
		document.addEventListener('pointerup', handleGripUp);
	};

	onCleanup(() => {
		if (rafPending) cancelAnimationFrame(rafPending);
		document.removeEventListener('pointermove', handleGripMove);
		document.removeEventListener('pointerup', handleGripUp);
	});

	return (
		<Show when={!timelineMinimized()}>
			<div
				ref={pillEl}
				class="absolute z-10 flex items-center gap-1 rounded-full border border-border bg-background/80 px-0.5 py-1 shadow-sm backdrop-blur-sm"
				style={{ right: `${position().right}px`, bottom: `${position().bottom}px` }}
				onPointerDown={(event) => event.stopPropagation()}
			>
				<div
					class="flex cursor-grab touch-none flex-col items-center justify-center gap-0.5 rounded-full px-1.5 py-0.5 hover:bg-accent active:cursor-grabbing"
					classList={{ 'cursor-grabbing': dragging() }}
					role="button"
					aria-label="Drag the zoom toolbar"
					onPointerDown={handleGripDown}
				>
					<div class="size-1 rounded-full bg-foreground/40" />
					<div class="size-1 rounded-full bg-foreground/40" />
				</div>

				<Tooltip>
					<TooltipTrigger
						as={Button}
						size="icon-square"
						variant="ghost"
						class="text-muted-foreground"
						onClick={() => timeline.zoomBy(1 / 1.25)}
					>
						<Icon name="minus" />
					</TooltipTrigger>
					<TooltipContent>Zoom out</TooltipContent>
				</Tooltip>

				<Slider
					class="w-24 sm:w-28"
					minValue={0}
					maxValue={1}
					step={0.002}
					value={[sliderValue()]}
					onChange={handleValueChange}
					onChangeEnd={handleValueChangeEnd}
				>
					<SliderTrack>
						<SliderFill />
						<SliderThumb />
					</SliderTrack>
				</Slider>

				<span class="w-10 text-center text-xxs text-muted-foreground tabular-nums">
					{zoomPercent()}%
				</span>

				<Tooltip>
					<TooltipTrigger
						as={Button}
						size="icon-square"
						variant="ghost"
						class="text-muted-foreground"
						onClick={() => timeline.zoomBy(1.25)}
					>
						<Icon name="plus-add" />
					</TooltipTrigger>
					<TooltipContent>Zoom in</TooltipContent>
				</Tooltip>

				<Separator orientation="vertical" class="mx-1 h-5" />

				<Tooltip>
					<TooltipTrigger
						as={Button}
						size="icon-square"
						variant="ghost"
						class="text-muted-foreground"
						onClick={() => timeline.zoomToFit()}
					>
						<Icon name="arrow-scale" class="size-4.5" />
					</TooltipTrigger>
					<TooltipContent>Fit to timeline</TooltipContent>
				</Tooltip>
			</div>
		</Show>
	);
}