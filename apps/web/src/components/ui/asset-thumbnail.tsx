/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, For, createResource, onCleanup } from 'solid-js';
import { cx } from '@/lib/cva';
import { getAssetFile } from '@diffusionstudio/runtime';
import { deriveThumbnail, DEFAULT_THUMBNAIL_WIDTH, derivePeaks, MASK_MIME_TYPE } from '@diffusionstudio/assets';

import type { Asset as LibraryAsset, AssetCache, AudioAsset, VideoAsset, ImageAsset } from '@diffusionstudio/assets';

/**
 * What a thumbnail needs of an asset: the runtime's `Asset` and the legacy
 * engine's both qualify.
 */
export type ThumbnailAsset = {
  id: string;
  type: string;
  mimeType: string;
  handle: { getFile(): Promise<File> };
  width?: number;
  height?: number;
  stat?: { mtime: number };
  lastModified?: number;
};

type Asset = ThumbnailAsset;

/** Re-renders a thumbnail when the asset, or the file behind it, changes. */
const keyOf = (asset: Asset): string => `${asset.id}:${asset.stat?.mtime ?? asset.lastModified ?? ''}`;

type ThumbnailSize = {
  width: number;
  height: number;
};

/**
 * The widths a thumbnail is derived at. A request is rounded up to one of
 * these so the cache keeps a handful of variants rather than one per layout,
 * and `DEFAULT_THUMBNAIL_WIDTH` is among them: the width the asset bar asks
 * for is the one stored without a variant, and the small boxes mostly land on
 * it too.
 */
const THUMBNAIL_WIDTHS = [64, 128, DEFAULT_THUMBNAIL_WIDTH, 600, 1200];

/**
 * How wide to derive for a box `size` CSS pixels across. Two things the box
 * itself does not say: the display's pixels are not CSS pixels, and the
 * picture is cropped to fill (`object-cover`), so a 16:9 asset in a square
 * box is scaled by its *height* and its width overflows. Both are upscales of
 * the derived bitmap, and they multiply — a 64px-wide thumbnail in a 64px
 * square is drawn at about 3.5× on a retina screen, which is the blur.
 *
 * Never wider than the asset itself: there is nothing above its own
 * resolution to derive.
 */
function sourceWidth(asset: Asset, size?: ThumbnailSize): number {
  if (!size) return DEFAULT_THUMBNAIL_WIDTH;

  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const aspect = asset.width && asset.height ? asset.width / asset.height : 1;
  const needed = dpr * Math.max(size.width, size.height * aspect);

  const width = THUMBNAIL_WIDTHS.find(candidate => candidate >= needed) ?? THUMBNAIL_WIDTHS.at(-1)!;
  return asset.width ? Math.min(width, Math.ceil(asset.width)) : width;
}

/** Whether the asset has a picture to thumbnail: an image, a video, or a mask's matte. */
const hasPicture = (asset: Asset): boolean =>
  asset.mimeType.startsWith('image') || asset.mimeType.startsWith('video') || asset.mimeType === MASK_MIME_TYPE;

/**
 * The thumbnail of an image, video or mask: from the library's cache when there is
 * one (kept in the project's `cache/` across sessions), derived on the spot
 * otherwise. Scaled to `width` at the asset's own aspect ratio; the
 * container crops it.
 */
function MediaThumbnail(props: { asset: Asset; width: number; cache?: AssetCache }) {
  let objectUrl: string | undefined;

  const releaseUrl = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = undefined;
  };

  const key = () => `${keyOf(props.asset)}:${props.width}:${props.cache ? 'cached' : ''}`;

  const loadThumbnail = async () => {
    releaseUrl();

    try {
      let blob: Blob | null = null;

      if (props.cache) {
        blob = await props.cache.thumbnail(props.asset as LibraryAsset, props.width);
      } else {
        const file = await getAssetFile(props.asset as unknown as ImageAsset | VideoAsset);
        blob = await deriveThumbnail(file, props.asset.mimeType, props.width);
      }
      objectUrl = blob ? URL.createObjectURL(blob) : undefined;

      return objectUrl;
    } catch {
      return undefined;
    }
  }

  const [url] = createResource(key, loadThumbnail);

  onCleanup(releaseUrl);

  return (
    <Show when={url()}>
      <img
        src={url()!}
        alt=""
        class="absolute inset-0 size-full object-cover select-none"
      />
    </Show>
  );
}

function TranscriptThumbnail() {
  return (
    <div class="absolute inset-0 bg-caption-background overflow-clip rounded-sm">
      <div class="absolute top-1 left-1 h-4 px-1 flex items-center bg-overlay rounded-sm">
        <span class="text-xxs text-foreground">Captions</span>
      </div>
      <div class="absolute top-9 left-1 right-0 bottom-1 flex items-center gap-0.5 overflow-clip">
        <div class="bg-caption-accent h-full rounded-sm shrink-0" style={{ width: '37px', 'min-width': '16px' }} />
        <div class="bg-caption-accent h-full rounded-sm shrink-0" style={{ width: '16px' }} />
        <div class="bg-caption-accent h-full rounded-sm shrink-0" style={{ width: '36px', 'min-width': '16px' }} />
        <div class="bg-caption-accent h-full rounded-sm shrink-0" style={{ width: '37px', 'min-width': '16px' }} />
      </div>
    </div>
  );
}

function AudioThumbnail(props: { asset: Asset; cache?: AssetCache }) {
  const loadPeaks = async () => {
    if (props.cache) {
      return props.cache.peaks(props.asset as unknown as AudioAsset | VideoAsset);
    }

    const file = await getAssetFile(props.asset as unknown as AudioAsset | VideoAsset);
    return derivePeaks(file);
  }

  const key = () => keyOf(props.asset);

  const [bins] = createResource(key, loadPeaks);

  return (
    <div class="absolute inset-0 pt-7 pb-1 bg-audio-background">
      <div class="flex items-center justify-center w-full h-full">
        <Show when={bins()}>
          <For each={Array.from(bins()!)}>
            {value => {
              const height = Math.min(Math.max(2, (value / 255) * 100), 98);
              return <div class="bg-audio-primary flex-1 rounded-sm" style={{ height: `${height}%` }} />;
            }}
          </For>
        </Show>
      </div>
    </div>
  );
}

type AssetThumbnailProps = {
  asset: Asset;
  class?: string;
  draggable?: boolean;
  size?: ThumbnailSize;
  cache?: AssetCache;
}

export function AssetThumbnail(props: AssetThumbnailProps) {
  const width = () => sourceWidth(props.asset, props.size);

  return (
    <div class={cx('relative', props.class)} draggable={props.draggable}>
      <Show when={hasPicture(props.asset)}>
        <MediaThumbnail asset={props.asset} width={width()} cache={props.cache} />
      </Show>
      <Show when={props.asset.mimeType.startsWith('audio')}>
        <AudioThumbnail asset={props.asset} cache={props.cache} />
      </Show>
      <Show when={props.asset.type === 'TRANSCRIPT'}>
        <TranscriptThumbnail />
      </Show>
      <div class="absolute inset-0 bg-transparent" />
    </div>
  );
}
