/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The on-canvas text editor: a textarea laid over the selected text or
 * caption, so double-clicking puts a cursor in the video and you type there.
 * Text edits live (the document is the source); a caption's words are
 * rewritten in its transcript on Enter or blur.
 */

import { Show, createEffect, createSignal } from 'solid-js';
import { useWorld } from '@diffusionstudio/koota-solid';
import { Caption, Chars, RenderSurface, Tool, ToolType, entityQuad, isText } from '@diffusionstudio/runtime';

import { commitCaptionText } from '@/engine/caption-edit';
import { useDerived, useEditor, useSelection } from '@/engine/hooks';
import { inlineEditing, setInlineEditing } from '@/engine/inline-edit';

export function InlineTextEditor() {
	const world = useWorld();
	const { nodes } = useSelection();
	const editor = useEditor();
	const [draft, setDraft] = createSignal('');
	let ref: HTMLTextAreaElement | undefined;

	/** The one selected text or caption, when there is exactly one. */
	const target = () => {
		const list = nodes();
		const entity = list.length === 1 ? list[0]! : null;
		return entity && (isText(entity) || entity.has(Chars)) ? entity : null;
	};

	/** The text's box in CSS pixels, sampled every frame so the camera can move. */
	const box = useDerived(
		() => {
			if (!inlineEditing()) return null;
			const entity = target();
			if (!entity) return null;

			const quad = entityQuad(world, entity);
			const resolution = world.get(RenderSurface)?.resolution ?? 1;
			const xs = quad.map((point) => point.x / resolution);
			const ys = quad.map((point) => point.y / resolution);
			const left = Math.min(...xs);
			const top = Math.min(...ys);
			return {
				left,
				top,
				width: Math.max(48, Math.max(...xs) - left),
				height: Math.max(28, Math.max(...ys) - top),
			};
		},
		(a, b) => JSON.stringify(a) === JSON.stringify(b),
	);

	createEffect(() => {
		const entity = target();
		if (!inlineEditing() || !entity) return;
		setDraft(entity.get(Chars)?.value ?? '');
		queueMicrotask(() => {
			ref?.focus();
			ref?.select();
		});
	});

	const finish = async (commit: boolean) => {
		if (!inlineEditing()) return;
		const entity = target();
		setInlineEditing(false);
		world.set(Tool, { value: ToolType.MOVE });
		if (commit && entity?.has(Caption)) await commitCaptionText(world, entity, draft().trim());
	};

	return (
		<Show when={inlineEditing() && target() && box()}>
			{(rect) => (
				<textarea
					ref={ref}
					value={draft()}
					onInput={(event) => {
						const value = event.currentTarget.value;
						setDraft(value);
						const entity = target();
						if (entity && isText(entity) && !entity.has(Caption)) editor.editText(entity, value);
					}}
					onKeyDown={(event) => {
						if (event.key === 'Enter' && !event.shiftKey) {
							event.preventDefault();
							ref?.blur();
						} else if (event.key === 'Escape') {
							event.preventDefault();
							void finish(false);
						}
					}}
					onBlur={() => void finish(true)}
					class="absolute z-50 resize-none rounded-sm border border-primary/60 bg-black/60 p-1 text-center text-white outline-none"
					style={{
						left: `${rect().left}px`,
						top: `${rect().top}px`,
						width: `${rect().width}px`,
						height: `${rect().height}px`,
						'font-size': '16px',
						'line-height': '1.2',
					}}
				/>
			)}
		</Show>
	);
}
