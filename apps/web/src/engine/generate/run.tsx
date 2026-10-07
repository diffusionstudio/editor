/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Generations on the canvas, from the request to the file in the library.
 *
 * - A prompt (`generate`) gets one empty geometry per output, placed beside
 *   the work (see ./placement) and brought into view. Each stands in for its
 *   output — the pulse, headed by the job's progress (see ./placeholder) — until
 *   the result lands as the geometry's paint.
 * - A transform (`transform`) is run over the media a node shows on top (see
 *   ./media); the node pulses meanwhile, and the result is laid over the paint
 *   it was made from, which is hidden rather than removed.
 *
 * What a model returns is downloaded into the project library, which only
 * ever holds files that exist: nothing is reserved there for a job in flight,
 * and a job that fails leaves no trace but the toast saying why.
 */

import { Audio, ImagePaint, Rect, VideoPaint, authoredElement, renderAuthored } from '@diffusionstudio/reconciler';
import { AssetId, Cache, getCameraMatrix, getNextName, getParentEntity, Library, Paint, revealRect, Root, Selected, Size, Source } from '@diffusionstudio/runtime';
import { assetName } from '@diffusionstudio/assets';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'somoto';

import { jobFailure, runJob } from '@/lib/jobs';
import { uploadFile } from '@/lib/uploads';

import { getDocumentEditor } from '../editor';
import { findPlacement, PLACEMENT_GAP } from './placement';
import { trackPlaceholder } from './placeholder';
import { topMedia } from './media';

import type { Asset, AssetLibrary } from '@diffusionstudio/assets';
import type { AssetRef, GenerateRequestInput, Job } from '@diffusionstudio/api-contract';
import type { Entity, World } from 'koota';
import type { NodeMedia } from './media';
import type { GenerationState, Placeholder } from './placeholder';

/** What a prompt asks for, as far as the canvas is concerned. */
export interface GenerationOutput {
	/** What each output lands as: a paint of its placeholder, or an `<audio>` in its place. */
	kind: 'image' | 'video' | 'audio';
	/** How many outputs the request makes, each with a placeholder of its own. */
	count: number;
	/** The box of each placeholder; a picture's is corrected to the result's proportions. */
	size: { width: number; height: number };
	/** What a failure is reported under, e.g. "Image generation failed". */
	title: string;
}

/**
 * The progress of one job, as its placeholders show it: "Queued" until the
 * job runs, then "Generating" with the share of its estimate that has passed
 * — counted on to the end, so a job that lands in time goes from a progress
 * straight to its name. Once the estimate is spent there is no progress left
 * to show: it reads "Taking a bit longer" while the model works, and "Almost
 * done" once the model is done and the result is on its way into the project.
 */
class Progress {
	private job: Job | undefined;
	/** When the job was first seen running, on this clock. */
	private since = 0;

	public readonly update = (job: Job): void => {
		if (job.status !== 'queued' && !this.since) this.since = Date.now();
		this.job = job;
	};

	public readonly state = (): GenerationState => {
		const job = this.job;
		if (!job || job.status === 'queued') return { label: 'Queued' };
		const progress = (Date.now() - this.since) / (job.etaSeconds * 1000);
		if (progress < 1) return { label: 'Generating', progress };
		return { label: job.status === 'succeeded' || job.phase === 'finalizing' ? 'Almost done' : 'Taking a bit longer' };
	};
}

/**
 * Generates what `request` asks for into empty geometries on the canvas (see
 * the module comment). `request` may take making — inputs to upload — so it
 * is made once the placeholders are there, from the moment of the prompt.
 */
export async function generate(
	world: World,
	output: GenerationOutput,
	request: GenerateRequestInput | (() => Promise<GenerateRequestInput>),
): Promise<void> {
	const library = world.get(Library);
	const root = world.get(Root);
	if (!library || !root?.get(Source)?.value) {
		toast('Nothing to generate into', { description: 'Open a project first.' });
		return;
	}

	const editor = getDocumentEditor(world);
	const { width, height } = output.size;
	const block = findPlacement(world, output.count * width + (output.count - 1) * PLACEMENT_GAP, height);

	revealRect(world, block);
	editor.reportEdit(root, 'camera', getCameraMatrix(world));

	const progress = new Progress();
	const placeholders: Placeholder[] = [];
	const inserted: Entity[] = [];

	// A picture or a clip keeps its proportions; a sound's box is only where it sits.
	const proportions = output.kind === 'audio' ? {} : { keepAspectRatio: true };

	for (let index = 0; index < output.count; index++) {
		const x = Math.round(block.x + index * (width + PLACEMENT_GAP));
		const y = Math.round(block.y);
		const [entity] = editor.insertElement(root, () => (
			<Rect {...proportions} x={x} y={y} width={width} height={height} />
		));
		const placeholder = entity && trackPlaceholder(world, entity, progress.state);
		if (!placeholder) continue;
		inserted.push(entity);
		placeholders.push(placeholder);
	}
	if (inserted.length) editor.select(inserted);

	try {
		const job = await runJob(typeof request === 'function' ? await request() : request, progress.update);
		if (job.status !== 'succeeded') throw new Error(jobFailure(job));

		const results = await Promise.all(job.assets.map((file) => storeResult(library, job, file)));
		let orphaned = 0;
		placeholders.forEach((placeholder, index) => {
			const entity = placeholder.entity();
			const result = results[index];
			if (!entity) orphaned += result ? 1 : 0;
			else if (result) land(world, entity, result);
			else editor.remove(entity);
		});
		if (orphaned) {
			toast('Generation finished', { description: 'Its placeholder was removed, so the result is in the library only.' });
		}
	} catch (error) {
		editor.remove(placeholders.map((placeholder) => placeholder.entity()).filter((entity) => entity !== undefined));
		report(output.title, error);
	} finally {
		for (const placeholder of placeholders) placeholder.release();
	}
}

/**
 * Runs `request` over the media `media` shows (see the module comment);
 * `request` is handed the uploaded input.
 */
export async function transform(
	world: World,
	media: NodeMedia,
	title: string,
	request: (input: AssetRef) => GenerateRequestInput,
): Promise<void> {
	const library = world.get(Library);
	const input = library?.get(media.paint.get(AssetId)?.value ?? '');
	if (!library || !input) {
		toast(title, { description: 'The media has not loaded yet.' });
		return;
	}

	const progress = new Progress();
	const placeholder = trackPlaceholder(world, media.node, progress.state);
	const paint = media.paint === media.node ? undefined : media.paint.get(Source)?.value;

	try {
		const job = await runJob(request(await uploadAsset(library, input)), progress.update);
		if (job.status !== 'succeeded') throw new Error(jobFailure(job));

		const [file] = job.assets;
		if (!file) throw new Error('The model returned nothing.');
		const result = await storeResult(library, job, file);

		const node = placeholder?.entity();
		if (node) overlay(world, node, paint, result);
		else toast('Generation finished', { description: 'Its element was removed, so the result is in the library only.' });
	} catch (error) {
		report(title, error);
	} finally {
		placeholder?.release();
	}
}

/** Uploads made this session, by library asset id: an input is sent once. */
const uploads = new Map<string, Promise<AssetRef>>();

/** The ref a request names a library asset by, uploading its bytes when the API lacks them. */
export function uploadAsset(library: AssetLibrary, asset: Asset): Promise<AssetRef> {
	let ref = uploads.get(asset.id);
	if (!ref) {
		ref = library.file(asset).then(uploadFile);
		ref.catch(() => uploads.delete(asset.id));
		uploads.set(asset.id, ref);
	}
	return ref;
}

/** Downloads one output of `job` into the library, noting the job it came from. */
async function storeResult(library: AssetLibrary, job: Job, file: Job['assets'][number]): Promise<Asset> {
	const response = await fetch(file.url);
	if (!response.ok) throw new Error(`Could not download the result (${response.status})`);
	const asset = await library.store(await response.blob(), { name: file.filename });
	return library.update(asset, { job: job.id });
}

const stem = (asset: Asset): string => assetName(asset).replace(/\.[^.]+$/, '');

/** Fills a prompt's placeholder with what it stood in for, named after it. */
function land(world: World, placeholder: Entity, asset: Asset): void {
	const editor = getDocumentEditor(world);
	const name = getNextName(world, stem(asset));

	if (asset.type === 'AUDIO') {
		// A sound is an element of its own, not a paint: it takes the
		// placeholder's place, and its selection.
		const parent = getParentEntity(placeholder);
		const props = authoredElement(placeholder)?.props ?? {};
		const selected = placeholder.has(Selected);
		if (!parent) return;
		const [audio] = editor.insertElement(parent, () => (
			<Audio name={name} src={asset.path} x={props.x as number} y={props.y as number} width={props.width as number} height={props.height as number} />
		), placeholder);
		editor.remove(placeholder);
		if (audio && selected) editor.select(audio, { extend: true });
		return;
	}

	editor.insertElement(placeholder, () => (
		asset.type === 'VIDEO' ? <VideoPaint src={asset.path} /> : <ImagePaint src={asset.path} />
	));
	editor.editProperty(placeholder, 'name', name);

	// The box was a guess at the result's proportions (a model may not take
	// the aspect ratio asked for); the width stays, the height follows.
	const size = placeholder.get(Size);
	if ('width' in asset && asset.width > 0 && size) {
		const height = Math.round((size.width * asset.height) / asset.width);
		if (Math.abs(height - size.height) > 1) editor.editProperty(placeholder, 'height', height);
	}
}

/**
 * Lays a transform's result over the paint it was made from, which is hidden
 * — not removed — so the original is a toggle away. Media that is the node's
 * own (`<image src>`) has no paint to hide; its `src` is pointed at the
 * result instead.
 */
function overlay(world: World, node: Entity, paintSource: string | undefined, asset: Asset): void {
	const editor = getDocumentEditor(world);
	const fills = node.get(Cache)?.fills ?? [];
	const paint = (paintSource && fills.find((fill) => fill.get(Source)?.value === paintSource)) || topMedia(node)?.paint;

	if (!paint || paint === node || !paint.has(Paint)) {
		editor.editProperty(node, 'src', asset.path);
		return;
	}

	// The new paint is drawn the way the old one was: fit, opacity, blending.
	const props = { ...authoredElement(paint)?.props };
	delete props.src;
	delete props.hidden;
	editor.editProperty(paint, 'hidden', true);
	editor.insertElement(node, () => renderAuthored({
		tag: asset.type === 'VIDEO' ? 'videoPaint' : 'imagePaint',
		props: { ...props, src: asset.path },
		children: [],
	}));
}

/** Tells the user why a generation came to nothing — unless the upgrade dialog already does. */
function report(title: string, error: unknown): void {
	if (error instanceof TRPCClientError && error.data?.code === 'PAYMENT_REQUIRED') return;
	console.error(`[generate] ${title}:`, error);
	toast.error(title, { description: error instanceof Error ? error.message : String(error) });
}
