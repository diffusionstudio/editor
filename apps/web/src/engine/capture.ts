/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The world an encode runs against: the project rendered a second time, into
 * a world of its own, reduced to the one node being encoded.
 *
 * Rendered rather than copied, because a copy of the entities is only what
 * the composition holds as data — a `<surface>`'s drawing, an `<html>`
 * subtree and every value a `useTicker` memo feeds live in the node the
 * project's render made, and the offline world has to have its own. So the
 * bundle that is on the canvas is mounted again here, against an offline
 * world at the export's frame rate, and the encoder is handed the result.
 *
 * The whole project renders, not the one scene: a scene is not a project, and
 * what each of them holds is only known by running the whole thing. The stage
 * is reduced to the scene straight after, before a system has looked at any
 * of it, so nothing outside it is ever drawn, decoded, mixed or advanced, nor
 * is any `src` of it resolved.
 */

import { mount } from '@diffusionstudio/reconciler';
import {
	Ai, ChildOf, FramePromises, FrameRate, Fonts, Hidden, Library, Mode, Project,
	RenderSurface, Root, Source, TranscriptionRequest,
	createRuntimeWorld, disposeDecoders, getParentNode, removeChild, resetCamera,
} from '@diffusionstudio/runtime';

import { loadProjectBundle } from '@/lib/db';
import { compileProject, isDesktop } from '@/projects';

import type { RuntimeMode } from '@diffusionstudio/runtime';
import type { Entity, World } from 'koota';

export interface CaptureOptions {
	/** Frames per second the copy is timed at; the source world's by default. */
	frameRate?: number;
	/** What is being encoded. Audio-only skips nothing, it just draws nothing. */
	mode?: RuntimeMode;
	/** The project's folder, to compile it fresh; the remembered bundle otherwise. */
	dir?: string;
}

/**
 * The code an encode mounts. Compiled fresh when the project's folder is
 * known: an element the editor inserted reaches the file without a recompile
 * (its own writes are kept from the watcher), so the bundle the last mount
 * remembered may predate it — and an encode of it would come up empty. The
 * remembered bundle answers off the desktop, where there is no compiler.
 */
async function bundleFor(source: World, dir?: string): Promise<string> {
	if (dir && isDesktop()) {
		const result = await compileProject(dir);
		if (!result.ok) throw new Error(result.error);
		return result.code;
	}

	const code = await loadProjectBundle(source.get(Project)?.id ?? '');
	if (!code) throw new Error('There is no project to render');
	return code;
}

export interface Capture {
	/** The world to hand to an encoder. */
	world: World;
	/** The node in it — the stage's only child. */
	node: Entity;
	/** Drops the render, the canvas, the decoders it opened, and the world. */
	dispose(): void;
}

/**
 * Builds the capture world for an encode of `node`, an entity of `source` —
 * the editor's world. A scene, for a render of the composition; any node for
 * an image capture of it alone. Throws when there is no project to render (or
 * it no longer compiles), when the node has no source stamp yet (an element
 * the writer has not put in the file), or when rendering the project produces
 * nothing for that stamp.
 */
export async function createCapture(source: World, node: Entity, options: CaptureOptions = {}): Promise<Capture> {
	const code = await bundleFor(source, options.dir);

	// The stamp, not the entity: the two worlds hand out ids of their own, and
	// the stamp is the same element in both.
	const stamp = node.get(Source)?.value;
	if (!stamp) {
		throw new Error('This element is not in the project source yet — save the project and try again.');
	}

	const mode = options.mode ?? 'offline-video';
	const frameRate = options.frameRate ?? source.get(FrameRate)?.value ?? 30;

	// Created before the world is filled: the DOM-backed paints (`<html>`,
	// `<htmlPaint>`) attach their layout roots to it as their element is made.
	// The encoder sizes it once it knows how big the picture is. It sits inside
	// the viewport, behind the app, not parked off-screen: the browser only
	// paints layout near the viewport, and drawElementImage draws from that
	// cached paint — on a canvas at left:-100000px (or below the fold) it
	// throws "no cached paint record" and every HTML paint captures blank.
	// Only the canvas's origin has to intersect the viewport, not its whole
	// box: a `layoutsubtree` child is paint-contained and records in full, so a
	// 4K canvas in a small window still captures its far corner.
	// `opacity:0` alone would not do — Blink skips painting a subtree under its
	// minimum visible opacity (0.0004) — but `will-change:opacity` keeps the
	// effect node composited, so the subtree is painted at opacity 0 all the
	// same and nothing shows through translucent UI above it. Canvas opacity is
	// not baked into what drawElementImage yields.
	const canvas = document.createElement('canvas');
	canvas.width = 2;
	canvas.height = 2;
	canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:-9999;opacity:0;will-change:opacity;pointer-events:none;';
	document.body.appendChild(canvas);

	// Shares the source's assets and generation service — a `src` names the
	// same file in both — and its fonts, which are loaded into the document
	// already, so copying the list only tracks them as loaded rather than
	// having this world add them again.
	const world = createRuntimeWorld(source.get(Project)?.id ?? '');
	world.set(Mode, { value: mode });
	world.set(Library, source.get(Library) ?? null);
	world.set(Ai, source.get(Ai) ?? null);
	world.set(Fonts, { list: [...(source.get(Fonts)?.list ?? [])] });
	world.set(RenderSurface, { canvas, ctx: canvas.getContext('2d'), resolution: 1 });
	world.set(FrameRate, { value: frameRate });
	// The barrier offline capture awaits: the systems push decoder and source
	// readiness here and the encoder drains it before sampling a frame.
	world.set(FramePromises, { list: [] });

	const dispose = (mounted?: { dispose(): void }) => () => {
		mounted?.dispose();
		canvas.remove();
		// Release the decoder file handles and caches, then the world slot
		// itself: koota caps live worlds at 16, so a throwaway one has to be
		// destroyed rather than dropped.
		disposeDecoders(world, world.get(Root)!);
		world.destroy();
	};

	let mounted: { dispose(): void };
	try {
		// The frame rate is set above, so every authored time lands in this
		// world's frames as the document converts it — nothing to rescale.
		mounted = mount(code, world);
	} catch (error) {
		dispose()();
		throw error;
	}

	const rendered = world.query(Source).find((entity) => entity.get(Source)?.value === stamp);

	if (!rendered) {
		dispose(mounted)();
		throw new Error(`The project rendered nothing for "${stamp}"`);
	}

	// A node from inside a scene becomes the whole world, so it goes to the
	// top and whatever kept it from being seen in there no longer applies —
	// it is what was asked for. A scene is already a root and keeps both.
	if (getParentNode(rendered) !== null) {
		removeChild(world, rendered, getParentNode(rendered)!);
		rendered.remove(Hidden);
	}

	// Down to the one node. Destroying a root takes its subtree with it
	// (ChildOf is autoDestroy 'orphan'); what those nodes held outside the
	// world — an `<html>` root parked on the canvas, a `<surface>`'s own
	// canvas — is unreachable from here and goes when the canvas does.
	for (const root of world.query(ChildOf(world.get(Root)!))) {
		if (root !== rendered) root.destroy();
	}
	// The project may have spelled `<stage camera={…}>`, which is where the
	// editor was last looking — no part of the composition, and the view an
	// encode draws with is the plain one.
	resetCamera(world);

	// A `<captions>` with no src transcribes the scene it is in, and a
	// transcription encodes that scene's audio — through a capture world of
	// its own, whose captions would ask for the transcript that is still being
	// made. Nothing audible comes from a caption anyway.
	if (mode === 'offline-audio') {
		for (const entity of world.query(TranscriptionRequest)) {
			entity.remove(TranscriptionRequest);
		}
	}

	return { world, node: rendered, dispose: dispose(mounted) };
}
