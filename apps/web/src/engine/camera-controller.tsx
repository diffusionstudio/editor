/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, onCleanup, onMount } from 'solid-js';
import { useTrait, useWorld } from '@diffusionstudio/koota/solid';
import { panCamera, setCamera, zoomCameraAt, getCamera, RenderSurface, getCameraMatrix, Root, Tool, ToolType } from '@diffusionstudio/runtime';
import { useEditor } from './hooks/use-editor';

import type { JSX } from 'solid-js';

/** deltaY is in lines (deltaMode 1) or pages (deltaMode 2) on some devices. */
const DELTA_MODE_SCALE = [1, 16, 600];

/** Cap a single wheel notch so a coarse mouse wheel doesn't jump zoom levels. */
const MAX_ZOOM_DELTA = 50;

/** Wheel pixels → zoom exponent. Higher = faster ctrl/pinch zoom. */
const ZOOM_SENSITIVITY = 0.01;

const LEFT_BUTTON = 0;
const MIDDLE_BUTTON = 1;

function isEditable(target: EventTarget | null): boolean {
	if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
	return target instanceof HTMLElement && target.isContentEditable;
}

export function CameraController(): JSX.Element {
	const world = useWorld();
	const surface = useTrait(world, RenderSurface);
	const editor = useEditor();

	const canvas = createMemo(() => {
		const target = surface()?.canvas;
		if (target instanceof HTMLCanvasElement) return target;
		return null;
	});

	let spaceHeld = false;
	let panning = false;
	let panPointerId: number | null = null;
	let startX = 0;
	let startY = 0;
	let startE = 0;
	let startF = 0;



	/** Pointer position in canvas CSS pixels. */
	const localPoint = (event: { clientX: number; clientY: number }): [x: number, y: number] => {
		const rect = canvas()?.getBoundingClientRect();
		if (!rect) return [0, 0];
		return [event.clientX - rect.left, event.clientY - rect.top];
	};

	const endPan = (): void => {
		if (!panning) return;
		panning = false;

		if (panPointerId !== null && canvas()?.hasPointerCapture(panPointerId)) {
			canvas()?.releasePointerCapture(panPointerId);
		}

		panPointerId = null;
	};

	const handleWheel = (event: WheelEvent): void => {
		// The page must not scroll and the browser must not run its own
		// ctrl-wheel page zoom while the cursor is over the stage.
		event.preventDefault();

		const scale = DELTA_MODE_SCALE[event.deltaMode] ?? 1;

		if (event.ctrlKey || event.metaKey) {
			const [x, y] = localPoint(event);
			const dy = Math.max(-MAX_ZOOM_DELTA, Math.min(MAX_ZOOM_DELTA, event.deltaY * scale));
			zoomCameraAt(world, x, y, Math.exp(-dy * ZOOM_SENSITIVITY));
		} else {
			panCamera(world, event.deltaX * scale, event.deltaY * scale);
		}

		editor.reportEdit(world.get(Root)!, 'camera', getCameraMatrix(world));
	};

	const handlePointerDown = (event: PointerEvent): void => {
		const armed = spaceHeld || world.get(Tool)?.value === ToolType.HAND || panning;
		if (event.button !== MIDDLE_BUTTON && !(armed && event.button === LEFT_BUTTON)) return;

		// Middle-click would otherwise start autoscroll on some platforms.
		event.preventDefault();

		panning = true;
		panPointerId = event.pointerId;
		canvas()?.setPointerCapture(event.pointerId);

		[startX, startY] = localPoint(event);
		const camera = getCamera(world);
		startE = camera.e;
		startF = camera.f;
	};

	const handlePointerMove = (event: PointerEvent): void => {
		if (!panning || event.pointerId !== panPointerId) return;

		// Absolute offset from the drag origin rather than per-move deltas, so
		// a long drag can't accumulate rounding error.
		const [x, y] = localPoint(event);
		setCamera(world, { e: startE + (x - startX), f: startF + (y - startY) });
		editor.reportEdit(world.get(Root)!, 'camera', getCameraMatrix(world));
	};

	const handlePointerUp = (event: PointerEvent): void => {
		if (event.pointerId !== panPointerId) return;
		endPan();
	};

	const handleKeyDown = (event: KeyboardEvent): void => {
		if (event.code !== 'Space' || event.repeat || isEditable(event.target)) return;
		spaceHeld = true;
	};

	const handleKeyUp = (event: KeyboardEvent): void => {
		if (event.code !== 'Space') return;
		spaceHeld = false;
		endPan();
	};

	const handleBlur = (): void => {
		// Key-up never arrives when focus leaves mid-hold (⌘-tab, devtools).
		spaceHeld = false;
		endPan();
	};

	onMount(() => {
		canvas()?.addEventListener('wheel', handleWheel, { passive: false });
		canvas()?.addEventListener('pointerdown', handlePointerDown);
		canvas()?.addEventListener('pointermove', handlePointerMove);
		canvas()?.addEventListener('pointerup', handlePointerUp);
		canvas()?.addEventListener('pointercancel', handlePointerUp);
		document.addEventListener('keydown', handleKeyDown);
		document.addEventListener('keyup', handleKeyUp);
		window.addEventListener('blur', handleBlur);
	})

	onCleanup(() => {
		canvas()?.removeEventListener('wheel', handleWheel);
		canvas()?.removeEventListener('pointerdown', handlePointerDown);
		canvas()?.removeEventListener('pointermove', handlePointerMove);
		canvas()?.removeEventListener('pointerup', handlePointerUp);
		canvas()?.removeEventListener('pointercancel', handlePointerUp);
		document.removeEventListener('keydown', handleKeyDown);
		document.removeEventListener('keyup', handleKeyUp);
		window.removeEventListener('blur', handleBlur);
		endPan();
	})

	return null;
}
