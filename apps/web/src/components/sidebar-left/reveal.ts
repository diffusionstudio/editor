/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";
import { toast } from "somoto";
import { setSidebarTab } from "@/agent-chat/store";
import { selectionAssets } from "@/engine/asset-folders";
import { assetFilePath } from "@/engine/library";
import { revealPath } from "@/lib/shell";

import type { Asset } from "@diffusionstudio/assets";
import type { World } from "koota";

const [assetReveal, setAssetReveal] = createSignal<Asset | null>(null);

export { assetReveal };

export function clearAssetReveal(): void {
  setAssetReveal(null);
}

export function revealInAssets(world: World): void {
  const [asset] = selectionAssets(world);
  if (!asset) return;
  setSidebarTab("assets");
  setAssetReveal(asset);
}

export function assetFinderPath(world: World, asset: Asset): string | undefined {
  return window.desktop ? assetFilePath(world, asset) : undefined;
}

export function revealAssetInFinder(world: World, asset: Asset): void {
  const path = assetFinderPath(world, asset);
  if (!path) return;
  revealPath(path).catch((error: unknown) => {
    toast.error("Failed to reveal in finder", { description: (error as Error).message });
  });
}

export function finderPath(world: World): string | undefined {
  const [asset] = selectionAssets(world);
  return asset && assetFinderPath(world, asset);
}

export function revealInFinder(world: World): void {
  const [asset] = selectionAssets(world);
  if (asset) revealAssetInFinder(world, asset);
}
