/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo } from "solid-js";
import { AssetId, PaintType } from "@diffusionstudio/runtime";
import { useDerived, useSelection } from "@/engine/hooks";
import { topMedia } from "@/engine/generate";
import { useLibrary } from "@/engine/library";

import type { Asset } from "@diffusionstudio/assets";
import type { NodeMedia } from "@/engine/generate";

/** A selected node's top media, and the library asset it shows once that has loaded. */
export interface SelectedMedia extends NodeMedia {
  asset?: Asset;
}

/** A node's top media with the id of the asset bound to it so far. */
type Shown = NodeMedia & { assetId?: string };

const sameMedia = (a: Shown[], b: Shown[]) =>
  a.length === b.length && a.every((media, index) => {
    const other = b[index]!;
    return media.node === other.node && media.paint === other.paint && media.assetId === other.assetId;
  });

/**
 * The media the selected nodes show on top (see `topMedia`) — what a prompt
 * references and a transform is run over. Sampled every frame: which paint
 * is on top is derived state, and changes without the selection changing (a
 * transform lands, a fill is hidden).
 */
export function useMediaSelection() {
  const library = useLibrary();
  const { nodes } = useSelection();

  const shown = useDerived<Shown[]>(
    () => nodes()
      .map(topMedia)
      .filter((media) => media !== undefined)
      .map((media) => ({ ...media, assetId: media.paint.get(AssetId)?.value })),
    sameMedia,
  );

  const media = createMemo<SelectedMedia[]>(() => {
    const lib = library();
    return shown().map(({ assetId, ...entry }) => ({ ...entry, asset: assetId ? lib?.get(assetId) : undefined }));
  });

  const imageMedia = createMemo(() => media().filter((entry) => entry.type === PaintType.IMAGE));
  const videoMedia = createMemo(() => media().filter((entry) => entry.type === PaintType.VIDEO));

  /** Selected pictures whose asset is in the library: what a prompt can reference. */
  const images = createMemo(() =>
    imageMedia().filter((entry): entry is SelectedMedia & { asset: Asset } => entry.asset?.type === "IMAGE"),
  );

  return { media, imageMedia, videoMedia, images };
}
