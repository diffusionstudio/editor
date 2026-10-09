/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The tools that put a new node on the stage: the shapes (rect, ellipse,
 * polygon), scene and text. A drag draws the node's box, a click drops one of
 * a default size centered on the pointer. A shape or text lands in the scene
 * the press was in, a scene always at the root.
 */

import { Ellipse, Polygon, Rect, Scene, SolidPaint, Text } from '@diffusionstudio/reconciler';
import {
	Computed, GeometryType, HitRegions, RenderSurface, Root, Source, Tool, ToolType,
	findSceneAt, getNextName, identity2D, rectToQuad, screenToWorld, store, traceShape, worldToLocal,
} from '@diffusionstudio/runtime';

import { getDocumentEditor } from './editor';
import { DrawTool, Pointer } from './traits';

import type { World } from 'koota';
import type { DispatchedPointerEvent, Point } from '@diffusionstudio/runtime';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

type DrawConfig = {
	namePrefix: string;
	/** The outline the preview traces. */
	geometry: GeometryType;
	fillColor: string;
	/** What the box is filled with while it is drawn; null for an outline only. */
	previewColor: string | null;
	/** The size a click drops, in document units. */
	defaultWidth: number;
	defaultHeight: number;
};

const DRAW_CONFIG: Partial<Record<ToolType, DrawConfig>> = {
	[ToolType.RECT]: {
		namePrefix: 'Rect',
		geometry: GeometryType.RECT,
		fillColor: '#E0E0E0',
		previewColor: '#E0E0E0',
		defaultWidth: 300,
		defaultHeight: 300,
	},
	[ToolType.ELLIPSE]: {
		namePrefix: 'Ellipse',
		geometry: GeometryType.ELLIPSE,
		fillColor: '#E0E0E0',
		previewColor: '#E0E0E0',
		defaultWidth: 300,
		defaultHeight: 300,
	},
	[ToolType.POLYGON]: {
		namePrefix: 'Polygon',
		geometry: GeometryType.POLYGON,
		fillColor: '#E0E0E0',
		previewColor: '#E0E0E0',
		defaultWidth: 300,
		defaultHeight: 300,
	},
	[ToolType.SCENE]: {
		namePrefix: 'Scene',
		geometry: GeometryType.RECT,
		fillColor: '#000000',
		previewColor: '#000000',
		defaultWidth: 1920,
		defaultHeight: 1080,
	},
	[ToolType.TEXT]: {
		namePrefix: 'Text',
		geometry: GeometryType.RECT,
		fillColor: '#FFFFFF',
		previewColor: null,
		// A clicked-in text sizes itself to its glyphs.
		defaultWidth: 0,
		defaultHeight: 0,
	},
};

const ACCENT = '#008CFF';
/** Below this many CSS px on either side, a drag is a click. */
const CLICK_THRESHOLD = 10;

export function isDrawTool(world: World): boolean {
	return !!DRAW_CONFIG[world.get(Tool)?.value ?? ToolType.MOVE];
}

/** The box from where the press began to the pointer, in device pixels. */
function getDrawnRect(world: World): { x: number; y: number; width: number; height: number } {
	const pointer = world.get(Pointer)!;
	return {
		x: Math.min(pointer.dragStartX, pointer.clientX),
		y: Math.min(pointer.dragStartY, pointer.clientY),
		width: Math.abs(pointer.clientX - pointer.dragStartX),
		height: Math.abs(pointer.clientY - pointer.dragStartY),
	};
}

/** A point in device pixels, in the document. */
function toDocument(world: World, x: number, y: number, resolution: number): Point {
	return screenToWorld(world, x / resolution, y / resolution);
}

/**
 * While a draw tool is up: the region over the whole stage that takes its
 * presses, pushed last so it sits over everything else, and the box being
 * drawn with its size under it.
 */
export function drawDrawTool(world: World, ctx: Ctx2D, resolution: number): void {
	const config = DRAW_CONFIG[world.get(Tool)?.value ?? ToolType.MOVE];
	if (!config) return;

	world.get(HitRegions)!.list.push({
		target: { kind: 'hud', id: 'draw', quad: rectToQuad(identity2D(), ctx.canvas.width, ctx.canvas.height) },
		callback: handleDrawInteraction,
	});

	// A press that panning took over never sees its release, so the box goes
	// with the button rather than waiting for a dragend that will not come.
	if (!world.get(DrawTool)?.drawing || world.get(Pointer)?.phase !== 'pressed') return;

	const rect = getDrawnRect(world);

	ctx.save();
	ctx.resetTransform();

	ctx.beginPath();
	ctx.translate(rect.x, rect.y);
	traceShape(ctx, config.geometry, rect.width, rect.height, 3);
	ctx.translate(-rect.x, -rect.y);
	if (config.previewColor) {
		ctx.fillStyle = config.previewColor;
		ctx.fill();
	}
	ctx.strokeStyle = ACCENT;
	ctx.lineWidth = Math.round(2 * resolution);
	ctx.stroke();

	const topLeft = toDocument(world, rect.x, rect.y, resolution);
	const bottomRight = toDocument(world, rect.x + rect.width, rect.y + rect.height, resolution);
	const text = `${Math.round(bottomRight.x - topLeft.x)}x${Math.round(bottomRight.y - topLeft.y)}`;

	ctx.translate(rect.x + rect.width / 2, rect.y + rect.height);
	ctx.scale(resolution, resolution);
	ctx.translate(0, 16);
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.font = '11px Inter, sans-serif';

	const boxWidth = ctx.measureText(text).width + 8;

	ctx.beginPath();
	ctx.roundRect(-boxWidth / 2, -9, boxWidth, 16, 3);
	ctx.fillStyle = ACCENT;
	ctx.fill();

	ctx.fillStyle = '#FFFFFF';
	ctx.fillText(text, 0, 0);

	ctx.restore();
}

/**
 * A press starts the box in the scene it landed in, the release puts the
 * node there and hands over to the move tool, or to text editing for a text.
 */
export function handleDrawInteraction(world: World, event: DispatchedPointerEvent): void {
	const resolution = world.get(RenderSurface)?.resolution ?? 1;

	if (event.type === 'dragstart') {
		const point = toDocument(world, event.clientX, event.clientY, resolution);
		world.set(DrawTool, { drawing: true, scene: findSceneAt(world, point.x, point.y) });
		return;
	}

	if (event.type !== 'dragend') return;

	const { drawing, scene } = world.get(DrawTool)!;
	world.set(DrawTool, { drawing: false, scene: null });

	const tool = world.get(Tool)?.value ?? ToolType.MOVE;
	const config = DRAW_CONFIG[tool];
	if (!drawing || !config) return;

	const rect = getDrawnRect(world);
	const threshold = CLICK_THRESHOLD * resolution;
	const isClick = rect.width < threshold || rect.height < threshold;

	const topLeft = toDocument(world, rect.x, rect.y, resolution);
	const bottomRight = toDocument(world, rect.x + rect.width, rect.y + rect.height, resolution);
	const targetScene = scene?.isAlive() ? scene : null;

	// Approximate text size from the parent scene's height.
	let fontSize = 16;
	if (tool === ToolType.TEXT && targetScene !== null) {
		const sceneHeight = store(world, Computed).height[targetScene.id()] ?? 0;
		fontSize = Math.max(8, Math.round(sceneHeight / 22.5));
	}

	let width: number;
	let height: number;
	if (!isClick) {
		width = Math.round(bottomRight.x - topLeft.x);
		height = Math.round(bottomRight.y - topLeft.y);
	} else if (tool === ToolType.TEXT) {
		// Rough text bounds based on "Text" (4 chars) at the chosen font size.
		width = Math.round(fontSize * 0.6 * 4);
		height = Math.round(fontSize * 1.2);
	} else {
		width = config.defaultWidth;
		height = config.defaultHeight;
	}

	let posX = isClick ? topLeft.x - width / 2 : topLeft.x;
	let posY = isClick ? topLeft.y - height / 2 : topLeft.y;

	// Scenes always live at the root; anything else may parent into a hovered scene.
	const parentScene = tool === ToolType.SCENE ? null : targetScene;
	if (parentScene !== null) {
		const local = worldToLocal(world, parentScene, posX, posY);
		posX = local.x;
		posY = local.y;
	}

	const parent = parentScene ?? world.get(Root)!;
	// Nothing to draw into until a project is mounted: the element would have
	// no file to be written to.
	if (!parent.get(Source)?.value) return;

	const editor = getDocumentEditor(world);
	const name = getNextName(world, config.namePrefix);
	const x = Math.round(posX);
	const y = Math.round(posY);
	// A clicked-in text sizes itself to its glyphs, so it takes no size.
	const size = tool !== ToolType.TEXT || !isClick ? { width, height } : {};

	const [entity] = editor.insertElement(parent, () => {
		if (tool === ToolType.SCENE) {
			return (
				<Scene name={name} x={x} y={y} width={width} height={height}>
					<SolidPaint color={config.fillColor} />
				</Scene>
			);
		}
		if (tool === ToolType.TEXT) {
			return (
				<Text name={name} x={x} y={y} {...size} fontSize={fontSize}>
					Text
					<SolidPaint color={config.fillColor} />
				</Text>
			);
		}
		if (tool === ToolType.ELLIPSE) {
			return (
				<Ellipse name={name} x={x} y={y} {...size}>
					<SolidPaint color={config.fillColor} />
				</Ellipse>
			);
		}
		if (tool === ToolType.POLYGON) {
			return (
				<Polygon name={name} x={x} y={y} {...size}>
					<SolidPaint color={config.fillColor} />
				</Polygon>
			);
		}
		return (
			<Rect name={name} x={x} y={y} {...size}>
				<SolidPaint color={config.fillColor} />
			</Rect>
		);
	});

	if (entity) {
		if (tool === ToolType.SCENE) editor.activate(entity);
		editor.select(entity);
	}

	world.set(Tool, { value: tool === ToolType.TEXT ? ToolType.TEXT_EDIT : ToolType.MOVE });
}
