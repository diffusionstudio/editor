/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { isAbsoluteSource, isProjectSource, isUrlSource } from "@diffusionstudio/assets";
import { DapiError } from "@diffusionstudio/dapi";

import type { Asset, AssetLibrary } from "@diffusionstudio/assets";
import type { EditorSession } from "../session";

/**
 * Where the files a job makes go: into the library, at `path` (see
 * `generatedPath`) or under the model's own names when that is null; or to a
 * path on disk the server writes (null: a fresh directory under the temp
 * dir). Settled when the job starts, so a bad `output` fails before any
 * credits are spent or any frame is worked on.
 */
export type Destination = { kind: "library"; path: string | null } | { kind: "disk"; path: string | null };

export function destination(output: string | undefined, session: EditorSession | null): Destination {
  if (output === undefined) return { kind: session ? "library" : "disk", path: null };
  if (isUrlSource(output)) throw new DapiError("invalid-input", `The result cannot be saved to a URL (${output}).`);
  if (/[\\/]$/.test(output)) throw new DapiError("invalid-input", `The output is the file to save, not a folder (got "${output}").`);
  if (isAbsoluteSource(output)) return { kind: "disk", path: output };
  if (!session) {
    throw new DapiError(
      "no-project",
      `"${output}" is a library path, which needs an open project — open one, or pass an absolute path to save the result elsewhere.`,
    );
  }
  return { kind: "library", path: output.replace(/^\.\//, "") };
}

/**
 * Puts `blob` into the library at `path`. A file the project made already
 * there is written over and taken in again at the same path, so everything
 * naming it shows the new one; a linked file of the user's is never written
 * over, and the new one gets a free name next to it instead.
 */
export async function storeAt(library: AssetLibrary, path: string, blob: Blob): Promise<Asset> {
  const existing = library.get(path);
  if (existing && isProjectSource(existing.source)) {
    await library.fs.write(existing.source, blob);
    return library.relink(existing, existing.source);
  }
  const slash = path.lastIndexOf("/");
  return library.store(blob, { folder: slash < 0 ? "" : path.slice(0, slash), name: path.slice(slash + 1) });
}
