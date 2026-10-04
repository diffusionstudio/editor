/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { generate, getAssetSpec, isAssetRef, isSerializedAssetRef, isTransformSpec, mapAssetInputs, transform } from '@diffusionstudio/jsx';
import { Prompt, authoredElement } from '@diffusionstudio/reconciler';
import { Cache, RenderSurface, Root, getEntityBounds, getNextName, getSelection, getViewport, screenToWorld } from '@diffusionstudio/runtime';
import { PROMPT_INPUT_IMAGE_MODEL_OPTIONS } from '@/components/genai/config';

import { getDocumentEditor } from './editor';
import { findEmptyPlacement } from './placement';
import { Pointer } from './traits';

import type {
	AssetInput, AssetRef, GenerateAudioOptions, GenerateImageOptions, GenerateSpec, GenerateVideoOptions, GenerateVoiceOptions,
	SerializedAssetInput, SerializedAssetRef,
} from '@diffusionstudio/jsx';
import type { Point } from '@diffusionstudio/runtime';
import type { Entity, World } from 'koota';
import type { DocumentEditor } from './editor';

export const PROMPT_SCALE = 2;
export const PROMPT_SIZE = { width: 544 * PROMPT_SCALE, height: 248 * PROMPT_SCALE };
export const PROMPT_MIN_SIZE = { width: 400 * PROMPT_SCALE, height: 200 * PROMPT_SCALE };
const PROMPT_GAP = 40;

let focusRequest: Entity | null = null;

export function takePromptFocus(entity: Entity): boolean {
	if (focusRequest !== entity || document.querySelector("[role='menu']")) return false;
	focusRequest = null;
	return true;
}

export function generationOf(ref: AssetRef): AssetRef | undefined {
	const spec = getAssetSpec(ref);
	if (!isTransformSpec(spec)) return ref;
	return isAssetRef(spec.input) ? generationOf(spec.input) : undefined;
}

export function withGeneration(ref: AssetRef, generation: AssetRef): AssetRef {
	if (!isTransformSpec(getAssetSpec(ref))) return generation;
	return mapAssetInputs(ref, (input) => (isAssetRef(input) ? withGeneration(input, generation) : input));
}

export function generateRef(spec: GenerateSpec): AssetRef {
	const { type, ...options } = spec;
	switch (type) {
		case 'image':
			return generate.image(options as GenerateImageOptions);
		case 'video':
			return generate.video(options as GenerateVideoOptions);
		case 'voice':
			return generate.voice(options as GenerateVoiceOptions);
		case 'audio':
			return generate.audio(options as GenerateAudioOptions);
	}
}

function reviveInput(input: SerializedAssetInput): AssetInput {
	return typeof input === 'string' ? input : reviveRef(input);
}

function reviveRef({ $asset: spec }: SerializedAssetRef): AssetRef {
	if ('input' in spec) return transform[spec.type](reviveInput(spec.input));
	const options: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(spec)) {
		options[key] = key === 'refs'
			? (value as SerializedAssetInput[]).map(reviveInput)
			: key === 'startFrame' || key === 'endFrame' ? reviveInput(value as SerializedAssetInput) : value;
	}
	return generateRef(options as GenerateSpec);
}

export function templateOf(value: unknown): AssetRef | undefined {
	if (isAssetRef(value)) return value;
	return isSerializedAssetRef(value) ? reviveRef(value) : undefined;
}

export function promptTemplate(entity: Entity): AssetRef | undefined {
	return templateOf(authoredElement(entity)?.props.template);
}

export function promptText(entity: Entity): string {
	const template = promptTemplate(entity);
	const generation = template && generationOf(template);
	const value = generation ? (getAssetSpec(generation) as GenerateSpec).prompt : authoredElement(entity)?.props.prompt;
	return typeof value === 'string' ? value : '';
}

export function setPromptText(editor: DocumentEditor, entity: Entity, text: string): void {
	const template = promptTemplate(entity);
	const generation = template && generationOf(template);
	if (!template || !generation) {
		editor.editProperty(entity, 'prompt', text);
		return;
	}
	const spec = getAssetSpec(generation) as GenerateSpec;
	editor.editProperty(entity, 'template', withGeneration(template, generateRef({ ...spec, prompt: text })));
}

function pointerOrCenter(world: World): Point {
	const pointer = world.get(Pointer);
	const resolution = world.get(RenderSurface)?.resolution ?? 1;
	if (pointer?.over) return screenToWorld(world, pointer.clientX / resolution, pointer.clientY / resolution);

	const viewport = getViewport(world);
	return screenToWorld(world, (viewport?.width ?? 0) / 2, (viewport?.height ?? 0) / 2);
}

export function forkTemplate(entity: Entity): AssetRef | undefined {
	const src = [entity, ...(entity.get(Cache)?.fills ?? [])]
		.map((candidate) => templateOf(authoredElement(candidate)?.props.src))
		.find((ref) => ref !== undefined);
	const generation = src && generationOf(src);
	if (!src || !generation) return undefined;

	const spec = { ...(getAssetSpec(generation) as GenerateSpec) };
	delete spec.seed;
	return withGeneration(src, generateRef(spec));
}

export function forkPrompt(world: World, entity: Entity): Entity | undefined {
	const template = forkTemplate(entity);
	if (!template) return undefined;

	const bounds = getEntityBounds(world, [entity]);
	const near = bounds ? { minX: bounds.x, minY: bounds.y, maxX: bounds.x + bounds.width, maxY: bounds.y + bounds.height } : undefined;
	return insertPrompt(world, findEmptyPlacement(world, PROMPT_SIZE.width, PROMPT_SIZE.height, PROMPT_GAP, near), template);
}

export function forkSelection(world: World): Entity | undefined {
	const entity = getSelection(world).find((selected) => forkTemplate(selected));
	return entity && forkPrompt(world, entity);
}

export function insertPrompt(
	world: World,
	at: Point = pointerOrCenter(world),
	template: AssetRef = generate.image({ prompt: '', model: PROMPT_INPUT_IMAGE_MODEL_OPTIONS[0].id, aspectRatio: '16:9' }),
): Entity | undefined {
	const root = world.get(Root);
	if (!root) return undefined;

	const editor = getDocumentEditor(world);
	const [entity] = editor.insertElement(root, () => (
		<Prompt
			name={getNextName(world, 'Prompt')}
			x={Math.round(at.x - PROMPT_SIZE.width / 2)}
			y={Math.round(at.y - PROMPT_SIZE.height / 2)}
			width={PROMPT_SIZE.width}
			height={PROMPT_SIZE.height}
			count={1}
			template={template}
		/>
	));

	if (entity) {
		editor.select([entity]);
		focusRequest = entity;
	}
	return entity;
}
