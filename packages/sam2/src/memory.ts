/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { MAX_POINTERS, MEM_DIM, MEMORY_FRAMES, MEMORY_ROW_BYTES, POINTER_BYTES, POINTER_TOKENS } from './constants';
import { createStorageBuffer } from './gpu';

import type { Sam2Geometry } from './constants';

type FrameMemory = {
	index: number;
	tokens: GPUBuffer;
	pointer: GPUBuffer;
};

/**
 * What memory attention sees of the frames already tracked: the memory of the
 * prompted frame, the most recent frames' memories, and the object pointers of
 * the last sixteen. Assembled on the GPU from copies of the encoder's outputs,
 * so nothing crosses to the CPU between frames.
 */
export class MemoryBank {
	readonly memory: GPUBuffer;
	readonly memoryPos: GPUBuffer;
	private positions: GPUBuffer[] | null = null;
	private conditioning: FrameMemory | null = null;
	private recent: FrameMemory[] = [];
	private readonly pool: FrameMemory[] = [];
	/** A frame memory's bytes; the object pointers follow the frames'. */
	private readonly blockBytes: number;
	private readonly pointerOffset: number;

	constructor(
		private readonly device: GPUDevice,
		geometry: Sam2Geometry,
		private readonly temporalEncoding: readonly (readonly number[])[],
	) {
		this.blockBytes = geometry.memoryBlockBytes;
		this.pointerOffset = MEMORY_FRAMES * geometry.memoryBlockBytes;
		this.memory = createStorageBuffer(device, geometry.memoryRows * MEMORY_ROW_BYTES, 'sam2 memory');
		this.memoryPos = createStorageBuffer(device, geometry.memoryRows * MEMORY_ROW_BYTES, 'sam2 memory_pos');
	}

	get hasPositions(): boolean {
		return this.positions !== null;
	}

	/**
	 * The memory encoder's `memory_pos` is the same for every frame, so each
	 * temporal slot's positions are laid down once: the spatial encoding plus
	 * the slot's row of the temporal table.
	 */
	setPositions(spatial: Float32Array): void {
		this.positions = this.temporalEncoding.map((row, slot) => {
			const data = new Float32Array(spatial.length);
			for (let i = 0; i < data.length; i++) data[i] = spatial[i]! + row[i % MEM_DIM]!;

			const buffer = createStorageBuffer(this.device, data.byteLength, `sam2 memory_pos slot ${slot}`);
			this.device.queue.writeBuffer(buffer, 0, data);
			return buffer;
		});
	}

	condition(index: number, tokens: GPUBuffer, pointer: GPUBuffer): void {
		this.reset();
		this.conditioning = this.retain(index, tokens, pointer);
	}

	push(index: number, tokens: GPUBuffer, pointer: GPUBuffer): void {
		this.recent.push(this.retain(index, tokens, pointer));
		while (this.recent.length > MAX_POINTERS - 1) this.pool.push(this.recent.shift()!);
	}

	/** Back to the prompted frame alone, for a pass in the other direction. */
	rewind(): void {
		this.pool.push(...this.recent);
		this.recent = [];
	}

	reset(): void {
		this.rewind();
		if (this.conditioning) this.pool.push(this.conditioning);
		this.conditioning = null;
	}

	/**
	 * Lays the bank out for frame `index` and returns each pointer's distance
	 * to it, normalized the way `pointer_tpos` expects. Slot 0 is the prompted
	 * frame, with the temporal table's last row; the other slots are the newest
	 * frames first, a frame `k` back with row `k - 1`. Empty slots and pointers
	 * repeat the newest entry, which the graph's fixed shapes require.
	 */
	assemble(index: number, totalFrames: number): number[] {
		const conditioning = this.conditioning;
		const positions = this.positions;
		if (!conditioning || !positions) throw new Error('The memory bank has no prompted frame');

		const newestFirst = [...this.recent].reverse();
		const blocks = [{ tokens: conditioning.tokens, pos: positions[positions.length - 1]! }];
		for (let slot = 1; slot < MEMORY_FRAMES; slot++) {
			const entry = newestFirst[slot - 1];
			blocks.push(entry ? { tokens: entry.tokens, pos: positions[slot - 1]! } : blocks[1] ?? blocks[0]!);
		}

		const pointers = [conditioning, ...newestFirst].slice(0, MAX_POINTERS);
		while (pointers.length < MAX_POINTERS) pointers.push(pointers[pointers.length - 1]!);

		const encoder = this.device.createCommandEncoder();
		blocks.forEach((block, slot) => {
			encoder.copyBufferToBuffer(block.tokens, 0, this.memory, slot * this.blockBytes, this.blockBytes);
			encoder.copyBufferToBuffer(block.pos, 0, this.memoryPos, slot * this.blockBytes, this.blockBytes);
		});
		pointers.forEach((entry, i) => {
			encoder.copyBufferToBuffer(entry.pointer, 0, this.memory, this.pointerOffset + i * POINTER_BYTES, POINTER_BYTES);
		});
		this.device.queue.submit([encoder.finish()]);

		const span = Math.max(1, Math.min(totalFrames, MAX_POINTERS) - 1);
		return pointers.map((entry) => Math.abs(index - entry.index) / span);
	}

	/** Writes the pointers' temporal positions, one [MEM_DIM] row per pointer repeated over its tokens. */
	setPointerPositions(positions: GPUBuffer): void {
		const encoder = this.device.createCommandEncoder();
		for (let i = 0; i < MAX_POINTERS; i++) {
			for (let token = 0; token < POINTER_TOKENS; token++) {
				const row = i * POINTER_TOKENS + token;
				encoder.copyBufferToBuffer(positions, i * MEMORY_ROW_BYTES, this.memoryPos, this.pointerOffset + row * MEMORY_ROW_BYTES, MEMORY_ROW_BYTES);
			}
		}
		this.device.queue.submit([encoder.finish()]);
	}

	dispose(): void {
		this.reset();
		for (const entry of this.pool) {
			entry.tokens.destroy();
			entry.pointer.destroy();
		}
		this.pool.length = 0;
		this.positions?.forEach((buffer) => buffer.destroy());
		this.memory.destroy();
		this.memoryPos.destroy();
	}

	private retain(index: number, tokens: GPUBuffer, pointer: GPUBuffer): FrameMemory {
		const entry = this.pool.pop() ?? {
			index,
			tokens: createStorageBuffer(this.device, this.blockBytes, 'sam2 frame memory'),
			pointer: createStorageBuffer(this.device, POINTER_BYTES, 'sam2 frame pointer'),
		};
		entry.index = index;

		const encoder = this.device.createCommandEncoder();
		encoder.copyBufferToBuffer(tokens, 0, entry.tokens, 0, this.blockBytes);
		encoder.copyBufferToBuffer(pointer, 0, entry.pointer, 0, POINTER_BYTES);
		this.device.queue.submit([encoder.finish()]);
		return entry;
	}
}
