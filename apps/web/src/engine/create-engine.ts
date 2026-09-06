/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { assetSystem, renderSystem, transformSystem, playbackSystem, motionSystem, AudioEngine, createRuntimeWorld, Geometry, Mode, RenderSurface, Time, ChildOf, syncInteractiveState } from '@diffusionstudio/runtime';
import { hudSystem } from './hud';
import { createSignal, type Accessor, type Setter } from 'solid-js';
import { AssetSelection, Hud, Keys, MODIFIER_KEYS, Pointer, PointerEvents, ProjectConfig, SnapLines } from './traits';
import { inputSystem } from './input/input-system';
import { clearClipFrames, clearClipPeaks, clearMedia, clearPeaks, timelineSystem, TimelineSurface } from './timeline';
import { shortcutSystem } from './input/shortcuts';
import { sourceErrorSystem } from './source-errors';

import type { RuntimeWorld } from '@diffusionstudio/runtime';
import type { CanvasPointerEvent, PointerEventType } from '@diffusionstudio/runtime';

export interface EngineOptions {
	/**
	 * Inject an existing AudioContext (e.g. shared across projects). When
	 * omitted, the engine creates and owns one; it is closed on dispose().
	 */
	audioContext?: AudioContext;
}

class Engine {
	readonly world: RuntimeWorld;

	private canvas: HTMLCanvasElement | null = null;
	private rafId: number | null = null;
	private lastTimestamp: number | null = null;
	private resizeObserver = new ResizeObserver(this.resize.bind(this));

	private readonly audioContext: AudioContext;
	private readonly ownsAudioContext: boolean;

	private unsubscribe: (() => void)[] = [];
	private interactiveDirty = true;

	public running: Accessor<boolean>;
	private setRunning: Setter<boolean>;

	/**
	 * Ticks once per frame, after the systems ran. The one signal derived
	 * state is sampled against (see `useDerived`); a plain Solid signal, so
	 * following the tick costs no koota subscription.
	 */
	public frame: Accessor<number>;
	private setFrame: Setter<number>;

	public constructor(projectId: string, options: EngineOptions = {}) {
		this.world = createRuntimeWorld(projectId);
		this.world.add(Pointer, Keys, SnapLines, Hud, PointerEvents, AssetSelection, ProjectConfig, TimelineSurface);

		this.unsubscribe.push(
			this.world.onAdd(ChildOf('*'), () => (this.interactiveDirty = true)),
			this.world.onRemove(ChildOf('*'), () => (this.interactiveDirty = true)),
			// The timeline keeps a clip's waveform and thumbnails by entity id,
			// and koota hands ids back out: a clip that is gone has to take its
			// pictures with it, or the next clip to be given its id inherits them.
			this.world.onRemove(Geometry, (entity) => {
				clearClipPeaks(entity.id());
				clearClipFrames(entity.id());
			}),
		);

		[this.running, this.setRunning] = createSignal(false);
		[this.frame, this.setFrame] = createSignal(0);

		this.ownsAudioContext = options.audioContext === undefined;
		this.audioContext = options.audioContext ?? new AudioContext({ latencyHint: 'playback' });
		this.world.set(AudioEngine, { context: this.audioContext });
	}

	private readonly onClick = (event: MouseEvent) => {
		this.addEvent('click', event);
	}

	private readonly onDoubleClick = (event: MouseEvent) => {
		this.addEvent('dblclick', event)
	}

	private readonly onPointerDown = (event: PointerEvent) => {
		this.addEvent('pointerdown', event)
	}

	private readonly onPointerMove = (event: PointerEvent) => {
		this.addEvent('pointermove', event)
	}

	private readonly onPointerUp = (event: PointerEvent) => {
		this.addEvent('pointerup', event)
	}

	/**
	 * Whether the pointer is on the stage, which a shortcut reads to tell a
	 * press that could start a canvas gesture from one that could not.
	 */
	private readonly onPointerEnter = () => {
		this.world.set(Pointer, { over: true });
	}

	private readonly onPointerLeave = () => {
		this.world.set(Pointer, { over: false });
	}

	private readonly onBlur = () => {
		// Key-up never arrives when focus leaves mid-hold (⌘-tab, devtools).
		this.world.get(Keys)!.held.clear();
	}

	/**
	 * Only records: what a press does is decided once a frame by the shortcut
	 * system. Presses in text fields belong to the field. The one thing
	 * decided here is whether the browser gets the event, since that cannot
	 * wait for the frame — backspace would have navigated by then.
	 */
	private readonly onKeyDown = (event: KeyboardEvent) => {
		if (
			event.target instanceof HTMLInputElement
			|| event.target instanceof HTMLTextAreaElement
			|| (event.target instanceof HTMLElement && event.target.isContentEditable)
		) return;

		const keys = this.world.get(Keys)!;
		const key = event.key.toLowerCase();
		const isMod = event.key === 'Meta' || event.key === 'Control';

		keys.held.add(key);
		if (isMod) keys.held.add('mod');
		if (!event.repeat || key.startsWith('arrow')) {
			keys.pressed.add(key);
			if (isMod) keys.pressed.add('mod');
		}

		event.preventDefault();
	}

	private readonly onKeyUp = (event: KeyboardEvent) => {
		const keys = this.world.get(Keys)!;
		const key = event.key.toLowerCase();
		const isMod = event.key === 'Meta' || event.key === 'Control';

		keys.held.delete(key);
		keys.lifted.add(key);

		if (!isMod) return;

		keys.held.delete('mod');
		keys.lifted.add('mod');

		for (const stale of [...keys.held]) {
			// macOS never delivers the key-up of a key released while ⌘ is held
			if (!MODIFIER_KEYS.has(stale)) keys.held.delete(stale);
		}
	};

	private readonly loop = (timestamp: number): void => {
		const delta = this.lastTimestamp === null ? 0 : timestamp - this.lastTimestamp;
		this.lastTimestamp = timestamp;
		this.world.set(Time, { now: timestamp, delta });

		if (this.interactiveDirty) {
			syncInteractiveState(this.world);
			this.interactiveDirty = false;
		}

		this.runSystems();
		this.setFrame((count) => count + 1);

		const keys = this.world.get(Keys);
		keys?.pressed.clear();
		keys?.lifted.clear();

		this.rafId = requestAnimationFrame(this.loop);
	}

	private resize(): void {
		const parent = this.canvas?.parentElement;
		if (!parent || !this.canvas) return;

		const { width, height } = parent.getBoundingClientRect();
		const dpr = window.devicePixelRatio;

		const pixelWidth = Math.round(width * dpr);
		const pixelHeight = Math.round(height * dpr);

		if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
			this.canvas.width = pixelWidth;
			this.canvas.height = pixelHeight;
		}
		this.canvas.style.width = `${width}px`;
		this.canvas.style.height = `${height}px`;

		this.world.set(RenderSurface, { resolution: dpr });

		this.runSystems();
	}

	private addEvent(type: PointerEventType, event: PointerEvent | MouseEvent): void {
		if (!this.canvas) return;
		const rect = this.canvas.getBoundingClientRect();
		const resolution = this.world.get(RenderSurface)?.resolution ?? 1;

		this.world.get(PointerEvents)?.queue.push({
			type,
			clientX: (event.clientX - rect.left) * resolution,
			clientY: (event.clientY - rect.top) * resolution,
			button: event.button,
		} as CanvasPointerEvent);
	};

	private runSystems(): void {
		inputSystem(this.world);
		shortcutSystem(this.world);
		assetSystem(this.world);
		sourceErrorSystem(this.world);
		playbackSystem(this.world);
		motionSystem(this.world);
		transformSystem(this.world);
		renderSystem(this.world);
		hudSystem(this.world);
		timelineSystem(this.world);
	}

	public start(): void {
		if (this.running()) return;
		this.setRunning(true);
		this.lastTimestamp = null;
		this.rafId = requestAnimationFrame(this.loop);
	}

	public stop(): void {
		this.setRunning(false);
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
	}

	public mount(canvas: HTMLCanvasElement): void {
		this.unsubscribeEventListeners();

		this.canvas = canvas;
		this.world.set(RenderSurface, { canvas, ctx: canvas.getContext('2d') });

		canvas.addEventListener('click', this.onClick);
		canvas.addEventListener('dblclick', this.onDoubleClick);
		canvas.addEventListener('pointerdown', this.onPointerDown);
		canvas.addEventListener('pointermove', this.onPointerMove);
		canvas.addEventListener('pointerenter', this.onPointerEnter);
		canvas.addEventListener('pointerleave', this.onPointerLeave);
		window.addEventListener('pointerup', this.onPointerUp);
		window.addEventListener('pointercancel', this.onPointerUp);
		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('keyup', this.onKeyUp);
		window.addEventListener('blur', this.onBlur);

		this.resizeObserver.observe(canvas.parentElement!);
	}

	public snapshot(): Promise<Blob | null> {
		const canvas = this.canvas;
		if (!canvas?.width || !canvas.height) return Promise.resolve(null);

		const mode = this.world.get(Mode)?.value ?? 'realtime';
		this.world.set(Mode, { value: 'offline-video' });
		renderSystem(this.world);

		const encoded = new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));

		this.world.set(Mode, { value: mode });
		renderSystem(this.world);
		hudSystem(this.world);

		return encoded;
	}

	public dispose(): void {
		this.stop();
		if (this.ownsAudioContext) {
			this.audioContext.close();
		}

		// The timeline's decoded pictures and peaks are of this project's
		// files, and are held outside the world: they go with the engine.
		clearPeaks();
		clearMedia();

		this.unsubscribeEventListeners();
		this.unsubscribe.forEach(unsubscribe => unsubscribe());
		this.unsubscribe.length = 0;
		this.world.get(PointerEvents)?.queue.splice(0);
		this.world.destroy();
	}

	private unsubscribeEventListeners(): void {
		this.canvas?.removeEventListener('click', this.onClick);
		this.canvas?.removeEventListener('dblclick', this.onDoubleClick);
		this.canvas?.removeEventListener('pointerdown', this.onPointerDown);
		this.canvas?.removeEventListener('pointermove', this.onPointerMove);
		this.canvas?.removeEventListener('pointerenter', this.onPointerEnter);
		this.canvas?.removeEventListener('pointerleave', this.onPointerLeave);
		window.removeEventListener('pointerup', this.onPointerUp);
		window.removeEventListener('pointercancel', this.onPointerUp);
		window.removeEventListener('keydown', this.onKeyDown);
		window.removeEventListener('keyup', this.onKeyUp);
		window.removeEventListener('blur', this.onBlur);
		this.resizeObserver.disconnect();
	}
}

export function createEngine(projectId: string, options: EngineOptions = {}): Engine {
	return new Engine(projectId, options);
}

export type { Engine };
