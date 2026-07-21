/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


import { onCleanup, onMount } from 'solid-js';
import { toast } from 'somoto';
import { useEngine } from '@/context/engine';
import { secondsToFrames, getNextName, GeometryType, PaintType, createEntity, switchActiveScene, addComponent, appendChild, setComponent, resizeEntity, getAssetFile } from '@/components/engine';
import { loadAsset } from "@/components/engine";
import { useTimeline } from '@/context/timeline';

import type { Asset } from '@/components/engine/db';
import type { Transcript } from '@diffusionstudio/api-contract';

export function Timeline() {
  const timeline = useTimeline();
  const { world, camera } = useEngine();


  const c = world.components;

  let root!: HTMLDivElement;


  onMount(() => {
    timeline.attachCanvas();
  });

  onCleanup(() => {
    timeline.detachCanvas();
  });

  const handleDropEvent = async (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const dropFrame = Math.max(0, timeline.clientToFrame(event.clientX));

    const droppedAssets: Asset[] = [];
    const assetIds = event.dataTransfer?.getData('application/x-asset-id')?.split(',').filter(Boolean);
    if (assetIds && assetIds.length > 0) {
      for (const id of assetIds) {
        const asset = world.assets.get(id);
        if (asset) droppedAssets.push(asset);
      }
    } else {
      const items = Array.from(event.dataTransfer?.items ?? []).filter(item => item.kind === 'file');
      for (const item of items) {
        try {
          droppedAssets.push(await loadAsset(world, item));
        } catch (e) {
          toast('Failed to import assets', {
            description: (e as Error).message,
          });
        }
      }
    }

    if (droppedAssets.length === 0) return;

    let activeScene = world.timelineIndex().root;
    if (activeScene === null) {
      const sized = droppedAssets.find(a => a.type === 'IMAGE' || a.type === 'VIDEO' || a.type === 'SEQUENCE');
      const sceneWidth = sized ? Math.round(sized.width) : 1920;
      const sceneHeight = sized ? Math.round(sized.height) : 1080;
      const worldX = Math.round(-sceneWidth / 2);
      const worldY = Math.round(-sceneHeight / 2);

      const sid = world.history.transaction('Add scene', () => {
        const sceneEid = createEntity(world);
        setComponent(world, sceneEid, c.Geometry, GeometryType.RECT);
        addComponent(world, sceneEid, c.Scene);
        addComponent(world, sceneEid, c.ClipsContent);
        setComponent(world, sceneEid, c.Playback, {});
        setComponent(world, sceneEid, c.Name, getNextName(world, 'Scene'));
        setComponent(world, sceneEid, c.Position, { x: worldX, y: worldY });
        resizeEntity(world, sceneEid, { width: sceneWidth, height: sceneHeight });
        setComponent(world, sceneEid, c.Color, 0x000000);

        const fillEid = createEntity(world);
        setComponent(world, fillEid, c.Paint, PaintType.SOLID);
        setComponent(world, fillEid, c.Color, 0x000000);
        appendChild(world, fillEid, sceneEid);
        return sceneEid;
      });

      switchActiveScene(world, sid);
      camera.centerRect({ x: worldX, y: worldY, width: sceneWidth, height: sceneHeight });
      activeScene = sid;
    }

    const sceneEid = activeScene;
    const delay = dropFrame;

    const placeAsset = async (asset: Asset) => {
      // Resolve async transcript data before opening the transaction so the
      // mutations stay synchronous — concurrent placeAsset calls (Promise.all)
      // must not interleave inside a shared transaction.
      let transcriptTrim: { start: number; end: number } | null = null;
      if (asset.type === 'TRANSCRIPT') {
        const file = await getAssetFile(asset);
        const transcript = JSON.parse(await file.text()) as Transcript;
        const lastWord = transcript.at(-1)?.words.at(-1);
        const firstWord = transcript.at(0)?.words.at(0);
        transcriptTrim = {
          start: secondsToFrames(firstWord?.start),
          end: secondsToFrames(lastWord?.end),
        };
      }

      world.history.transaction('Add clip', () => {
        const eid = createEntity(world);
        setComponent(world, eid, c.Name, asset.name);
        setComponent(world, eid, c.Delay, delay);

        if (asset.type === 'IMAGE' || asset.type === 'VIDEO' || asset.type === 'SEQUENCE') {
          // Author dimensions from the source media; spatial layout is centered by
          // the transform system since no Position is set here.
          const width = Math.round(asset.width);
          const height = Math.round(asset.height);
          resizeEntity(world, eid, { width, height });
          setComponent(world, eid, c.KeepAspectRatio, { width, height });
        }

        if (asset.type === 'TRANSCRIPT') {
          setComponent(world, eid, c.Geometry, GeometryType.TEXT);
          setComponent(world, eid, c.Caption, {});
          if (transcriptTrim) setComponent(world, eid, c.Trim, transcriptTrim);
        } else {
          setComponent(world, eid, c.Geometry, GeometryType.RECT);

          // Other assets need a paint component
          let paint = PaintType.IMAGE;
          if (asset.type === 'SEQUENCE') paint = PaintType.SEQUENCE;
          if (asset.type === 'VIDEO') paint = PaintType.VIDEO;
          if (asset.type === 'AUDIO') paint = PaintType.WAVEFORM;
          const fillEid = createEntity(world);
          setComponent(world, fillEid, c.Paint, paint);
          setComponent(world, fillEid, c.AssetId, asset.id);

          if (asset.type === 'AUDIO') {
            addComponent(world, fillEid, c.Hidden);
          }

          appendChild(world, fillEid, eid);
        }

        if (asset.type === 'AUDIO') {
          addComponent(world, eid, c.Audio);
          resizeEntity(world, eid, { width: 500, height: 150 });
        }

        if (asset.type === 'AUDIO' || asset.type === 'TRANSCRIPT') {
          setComponent(world, eid, c.AssetId, asset.id);
        }

        appendChild(world, eid, sceneEid);
      });
    };

    await Promise.all(droppedAssets.map(asset => placeAsset(asset)));
  }

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'copy';
  }

  return (
    <div
      ref={root}
      class="relative size-full"
      data-timeline-surface
    >
      <canvas
        class="absolute inset-0"
        id="timeline-canvas"
        on:drop={handleDropEvent}
        on:dragover={handleDragOver}
      />
    </div>
  );
}
