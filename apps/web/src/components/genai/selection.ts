/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What the prompt box has to work with. Two readings of the selection, for
// two different questions:
//
// `imageNodes`/`videoNodes` are what the element *is*, which is what a
// source modifier applies to — a picture that is still generating is still a
// picture, and `removeBackground` can be asked of it before it exists.
//
// `images`/`videos` are what the element currently *shows*, which is what a
// reference needs: a library asset with a path to name it by.

import { createMemo } from "solid-js";
import { AssetId } from "@diffusionstudio/runtime";
import { authoredElement } from "@diffusionstudio/reconciler";
import { useSelection } from "@/engine/hooks";
import { useLibrary } from "@/engine/library";

import type { Asset } from "@diffusionstudio/assets";
import type { Entity } from "koota";

/** A selected node and the library asset it is bound to. */
export interface BoundNode {
  entity: Entity;
  asset: Asset;
}

export function useMediaSelection() {
  const library = useLibrary();
  const { nodes } = useSelection();

  const tagged = (tag: string) =>
    createMemo(() => nodes().filter((entity) => authoredElement(entity)?.tag === tag));

  const imageNodes = tagged("image");
  const videoNodes = tagged("video");

  const bound = createMemo(() => {
    const lib = library();
    if (!lib) return [];

    const entries: BoundNode[] = [];
    for (const entity of nodes()) {
      const id = entity.get(AssetId)?.value;
      const asset = id ? lib.get(id) : undefined;
      if (asset) entries.push({ entity, asset });
    }
    return entries;
  });

  const images = createMemo(() => bound().filter((entry) => entry.asset.type === "IMAGE"));

  return { bound, images, imageNodes, videoNodes };
}
