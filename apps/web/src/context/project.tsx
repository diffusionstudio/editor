/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The open project, for everything that acts on it. A project is three names
// at once and they come apart: the id is what it *is* (the URL, the key the
// world is under), the folder is where it lives (and moves, when the project
// is renamed), and the display name is what the user calls it. Resolving the
// URL to a project happens once, in ProjectPage; this is that answer, kept
// current as the project is renamed underneath the editor.

import { createContext, createMemo, createSignal, useContext, type Accessor, type JSX } from 'solid-js';

import { getProject, renameProject } from '@/projects';

import type { ProjectInfo } from '@/projects';
import { isBrowserCompanionRenderer } from '@/lib/companion-authority';

export type ProjectContextValue = {
	/** package.json `projectId`: what the project is, whatever it is called. */
	id: Accessor<string>;
	/** Absolute project folder. Moves when the project is renamed. */
	dir: Accessor<string>;
	/** package.json `displayName`: what the user calls it. */
	name: Accessor<string>;
	/** Renames the project — the record, and the folder with it. */
	rename: (displayName: string) => Promise<void>;
	/** Re-reads the record, for when something else wrote it. */
	refresh: () => Promise<void>;
};

const ProjectContext = createContext<ProjectContextValue>();

export function ProjectProvider(props: { project: ProjectInfo; children: JSX.Element }) {
	// Seeded once: the subtree is keyed on the project, so a different one
	// arrives as a new provider rather than as a new value here.
	const [info, setInfo] = createSignal(props.project);

	// Memos, not plain reads: `dir` re-mounts the scene when it changes, and a
	// refresh that found nothing new must not look like a move.
	const id = createMemo(() => info().id);
	const dir = createMemo(() => info().dir);
	const name = createMemo(() => info().displayName);

	const rename = async (displayName: string): Promise<void> => {
		if (isBrowserCompanionRenderer()) throw new Error('Browser companion is read-only');
		setInfo(await renameProject(dir(), displayName));
	};

	const refresh = async (): Promise<void> => {
		const next = await getProject(dir());
		if (next) setInfo(next);
	};

	return (
		<ProjectContext.Provider value={{ id, dir, name, rename, refresh }}>
			{props.children}
		</ProjectContext.Provider>
	);
}

export function useProject(): ProjectContextValue {
	const project = useContext(ProjectContext);
	if (!project) throw new Error('useProject must be used within a ProjectProvider');
	return project;
}
