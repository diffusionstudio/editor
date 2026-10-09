/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createMemo, createResource, createSignal, onCleanup } from 'solid-js';
import { ProgressSlider } from "@/components/ui/progress-slider";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Icon } from "@/components/ui/icon";
import { formatDuration } from "@/utils/formatters";
import { getAssetFile } from "@diffusionstudio/runtime";
import { derivePeaks, assetName } from "@diffusionstudio/assets";
import { useLibrary } from "@/engine/library";

import type { Asset } from '@diffusionstudio/assets';

type VisualAsset = Extract<Asset, { type: 'IMAGE' | 'VIDEO' | 'SEQUENCE' }>;

const keyOf = (asset: Asset): string => `${asset.id}:${asset.stat?.mtime ?? ''}`;

export function AssetInfoPreview(props: { asset: Asset }) {
  const library = useLibrary();
  let mediaRef: HTMLMediaElement | undefined;
  let prevObjectUrl: string | undefined;

  const [objectUrl] = createResource(
    () => keyOf(props.asset),
    async () => {
      if (prevObjectUrl) {
        URL.revokeObjectURL(prevObjectUrl);
        prevObjectUrl = undefined;
      }

      try {
        const file = await getAssetFile(props.asset);
        prevObjectUrl = URL.createObjectURL(file);
        return prevObjectUrl;
      } catch {
        return undefined;
      }
    },
  );

  const [peaks] = createResource(
    () => props.asset.type === 'AUDIO' ? keyOf(props.asset) : null,
    async () => {
      const cache = library()?.cache;
      if (cache) return cache.peaks(props.asset);
      return derivePeaks(await getAssetFile(props.asset));
    },
  );

  const [duration, setDuration] = createSignal(0);
  const [currentTime, setCurrentTime] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);

  const isImage = createMemo(() => props.asset.type === 'IMAGE' || props.asset.type === 'SEQUENCE');
  const isVideo = createMemo(() => props.asset.type === 'VIDEO');
  const isAudio = createMemo(() => props.asset.type === 'AUDIO');
  const isTranscript = createMemo(() => props.asset.type === 'TRANSCRIPT');
  const canPlay = createMemo(() => isVideo() || isAudio());

  const showProgress = createMemo(() => canPlay());

  const progress = createMemo(() => {
    const mediaDuration = duration();
    if (mediaDuration === 0) return 0;
    return (currentTime() / mediaDuration) * 100;
  });

  const setProgress = (value: number) => {
    const mediaDuration = duration();
    if (mediaDuration === 0 || !mediaRef) return;
    const nextTime = (value / 100) * mediaDuration;
    mediaRef.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const togglePlayback = () => {
    if (!mediaRef) return;

    if (mediaRef.paused) {
      void mediaRef.play();
      return;
    }

    mediaRef.pause();
  };

  const timeLabel = createMemo(() => {
    return `${formatDuration(currentTime())} / ${formatDuration(duration())}`;
  });

  const aspectRatio = createMemo(() => {
    if (isAudio() || isTranscript()) return '16 / 9';

    const visualAsset = props.asset as VisualAsset;
    if (visualAsset.width > 0 && visualAsset.height > 0) {
      return `${visualAsset.width} / ${visualAsset.height}`;
    }

    return undefined;
  });

  onCleanup(() => {
    if (prevObjectUrl) {
      URL.revokeObjectURL(prevObjectUrl);
      prevObjectUrl = undefined;
    }
  });

  return (
    <div class="flex flex-col gap-2">
      <div
        class="group relative w-full overflow-clip rounded-md border border-border bg-accent"
        style={{ 'aspect-ratio': aspectRatio() }}
      >
        <Show when={isTranscript()}>
          <div class="absolute inset-0 bg-caption-background overflow-clip">
            <div class="absolute top-1 left-1 h-4 px-1 flex items-center bg-overlay rounded-sm">
              <span class="text-xxs leading text-white">Captions</span>
            </div>
            <div class="absolute top-[54%] bottom-1 left-1 right-0 flex items-center gap-0.5 overflow-clip">
              <div class="bg-caption-accent h-full rounded-sm shrink-0" style={{ width: '74px', 'min-width': '16px' }} />
              <div class="bg-caption-accent h-full rounded-sm shrink-0" style={{ width: '32px' }} />
              <div class="bg-caption-accent h-full rounded-sm shrink-0" style={{ width: '72px', 'min-width': '16px' }} />
              <div class="bg-caption-accent h-full rounded-sm shrink-0" style={{ width: '72px', 'min-width': '16px' }} />
            </div>
          </div>
        </Show>
        <Show when={objectUrl()}>
          {url => (
            <>
              <Show when={isVideo()}>
                <video
                  class="size-full object-cover"
                  ref={el => mediaRef = el}
                  src={url()}
                  controls={false}
                  preload='metadata'
                  playsinline
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                />
              </Show>
              <Show when={isAudio()}>
                <div class="absolute inset-0 py-2 bg-audio-background">
                  <div class="flex items-center justify-center w-full h-full">
                    <Show when={peaks()}>
                      <For each={Array.from(peaks()!)}>
                        {value => {
                          const height = Math.min(Math.max(2, (value / 255) * 100), 98);
                          return <div class="bg-audio-primary flex-1 rounded-sm" style={{ height: `${height}%` }} />;
                        }}
                      </For>
                    </Show>
                  </div>
                </div>
                <audio
                  ref={el => mediaRef = el}
                  src={url()}
                  controls={false}
                  preload='metadata'
                  class="hidden"
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                />
              </Show>
              <Show when={isImage()}>
                <img class="size-full object-cover" src={url()} alt={assetName(props.asset)} />
              </Show>
            </>
          )}
        </Show>
        <Show when={canPlay()}>
          <div class="absolute inset-0 bg-overlay opacity-0 transition-opacity group-hover:opacity-100 flex items-center justify-center">
            <div class="absolute left-1 top-1 z-10 flex h-4 items-center justify-center rounded-sm bg-overlay px-1">
              <span class="font-mono text-xxs text-foreground">
                {timeLabel()}
              </span>
            </div>
            <Tooltip>
              <TooltipTrigger
                as={Button}
                type="button"
                size="icon-square"
                variant="default"
                onClick={togglePlayback}
              >
                <Icon name={playing() ? "controls-pause" : "controls-play"} />
              </TooltipTrigger>
              <TooltipContent>{playing() ? "Pause" : "Play"}</TooltipContent>
            </Tooltip>
          </div>
        </Show>
      </div>
      <Show when={showProgress()} fallback={<div class="h-3" />}>
        <div class="h-11 flex items-center">
          <ProgressSlider class="w-full" value={progress()} minValue={0} maxValue={100} onChange={setProgress} />
        </div>
      </Show>
    </div>
  );
}
