/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The prompt box as it was last left, kept across sessions so it opens the
 * way it was closed. Its inputs are not kept: they name assets of one
 * project's library, and the box is the same in every project.
 */

import { store } from "@/init";
import { createDefaultConfig, fitToModel } from "./requests";

import type { PromptMode } from "./config";
import type { GenerationConfig } from "./types";

/**
 * Bump when `GenerationConfig` changes in a way a saved config can no longer
 * be read as: configs saved under another version are dropped, not migrated.
 * Changes `fitToModel` absorbs (a retired model, other settings a model
 * takes) need no bump.
 */
const VERSION = 1;
const KEY = "prompt-input.config";

type SavedConfig = { version: number; config: GenerationConfig };

export function saveConfig(config: GenerationConfig): void {
  const settings = { ...config, imageRefIds: undefined, startFrameImageId: undefined, endFrameImageId: undefined };
  store.set<SavedConfig>(KEY, { version: VERSION, config: settings });
}

/** The config last saved, fitted to its model; undefined when none was saved under this version. */
export function loadConfig(): GenerationConfig | undefined {
  try {
    const saved = store.get<SavedConfig>(KEY);
    if (saved?.version !== VERSION) return undefined;
    return fitToModel(saved.config);
  } catch {
    // Unreadable: written by hand, or by a version that forgot to bump.
    return undefined;
  }
}

/**
 * The prompt box in `mode`: as it was last left when that was in `mode`,
 * else the mode's default with the last prompt carried over, the way
 * switching modes carries it.
 */
export function restoreConfig(mode: PromptMode): GenerationConfig {
  const saved = loadConfig();
  return saved?.mode === mode ? saved : createDefaultConfig(mode, saved?.prompt);
}
