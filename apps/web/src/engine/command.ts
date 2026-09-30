/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A command runs on nodes the user picks for it: while one is pending the
// command bar is over the canvas, what is selected and the command takes is
// what it would run on, and Confirm (⌘↵) runs it on them. Which command is
// pending is the page's to hold (see `CommandProvider`); what it would run
// on is read off the world here.

import { AdjustmentLayer, Geometry, Group, Selected } from '@diffusionstudio/runtime';
import { Or } from 'koota';

import type { Entity, World } from 'koota';

export interface Command {
	id: string;
	/** Names what it applies to, so the palette reads as "do this to that". */
	label: string;
	/** One line under the label: what running it does. */
	description: string;
	icon: string;
	/** More words the palette's search should find it by. */
	keywords?: string[];
	/** What the bar asks for while nothing it takes is selected. */
	hint: string;
	/** What it takes, as one and as many, for the bar's count. */
	noun: readonly [one: string, many: string];
	/** How many it takes at once, when it works on one thing at a time. */
	limit?: number;
	/** Whether a selected node is one it takes. */
	accepts(node: Entity): boolean;
	/** Runs it on the picked nodes. */
	run(nodes: Entity[]): void;
	/** Whether it still has what it works on; the bar comes down once it has not. */
	available?(): boolean;
	/** What taking it down without running it leaves behind. */
	cancel?(): void;
}

/** The node kinds a command can be run on. */
const NODES = Or(Geometry, Group, AdjustmentLayer);

/** The selected nodes `command` takes: what Confirm would run it on. */
export function getCommandPicks(world: World, command: Command): Entity[] {
	return [...world.query(Selected, NODES)].filter((node) => command.accepts(node));
}

/** Whether `picks` are something `command` can run on: any at all, and no more than it takes. */
export function canRunCommand(command: Command, picks: Entity[]): boolean {
	return picks.length > 0 && picks.length <= (command.limit ?? Infinity);
}
