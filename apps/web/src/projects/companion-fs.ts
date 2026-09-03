import type { FsEntry, Manifest, ProjectFS } from "@diffusionstudio/assets";

const UNSUPPORTED = "Local media is unsupported in the Phase A browser companion";

export async function grantCompanionProjectFolder(): Promise<void> {
  throw new Error(UNSUPPORTED);
}

export async function companionFolderGranted(): Promise<boolean> {
  return false;
}

export function onCompanionFolderChange(_listener: () => void): () => void {
  return () => {};
}

export function createCompanionProjectFS(_projectId: string): ProjectFS {
  return {
    readManifest: async (): Promise<Manifest> => ({ version: 1, folders: [], assets: [] }),
    writeManifest: async () => { throw new Error("Browser companion is read-only"); },
    list: async (_source): Promise<FsEntry[]> => [],
    stat: async (_source) => null,
    file: async (_source) => { throw new Error(UNSUPPORTED); },
    write: async () => { throw new Error("Browser companion is read-only"); },
    remove: async () => { throw new Error("Browser companion is read-only"); },
    pathOf: () => null,
  };
}

/** Companion project config is deliberately not part of the relay. */
export async function readCompanionProjectConfig(): Promise<null> {
  return null;
}
