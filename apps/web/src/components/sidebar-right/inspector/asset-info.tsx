/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { For, Show, Match, Switch, createMemo, createResource, createSignal, type Accessor } from "solid-js";
import {
  formatAspectRatio,
  formatBytes,
  formatChannels,
  formatDuration,
  formatMimeTypeLabel,
  formatAssetDate
} from "@/utils/formatters";
import { AssetInfoPreview } from "./asset-info-preview";
import { supabase } from "@/lib/supabase";
import { toClientConfig } from "@/components/genai/use-generation-records";
import { useWorld } from "@diffusionstudio/koota/solid";
import { assetName } from "@diffusionstudio/assets";
import { useLibrary } from "@/engine/library";
import { useAssetSelection } from "@/engine/hooks";
import { insertAssetAtPlayhead, replaceAssetSource } from "@/engine/asset-actions";

import type { Asset } from "@diffusionstudio/assets";

/** Information about the library asset picked in the assets panel. */
export function AssetInfoPanel() {
  const world = useWorld();
  const library = useLibrary();
  const selection = useAssetSelection();

  const [nameExpanded, setNameExpanded] = createSignal(false);

  const handleReplace = async () => {
    const lib = library();
    const asset = selection.asset();
    if (!lib || !asset) return;
    // A relink mints a new id; keep the panel on the asset.
    const next = await replaceAssetSource(lib, asset);
    if (next) selection.select(next);
  };

  const handleInsert = () => {
    const asset = selection.asset();
    if (asset) insertAssetAtPlayhead(world, asset);
  };

  const metadataRows = useAssetMetadataRows(selection.asset);

  return (
    <div class="flex flex-col w-full px-4 border-t border-border">
      <div class="h-12 flex items-center justify-between">
        <span class="text-base font-strong">Information</span>
      </div>
      <Show when={selection.asset()}>
        {asset => <AssetInfoPreview asset={asset()} />}
      </Show>

      <div class="flex flex-col gap-2 my-2">
        <Button variant="default" class="w-full" onClick={handleInsert}>
          Insert at playhead
        </Button>
        <Button variant="secondary" class="w-full" onClick={handleReplace}>
          Replace source
        </Button>
      </div>

      <button
        type="button"
        onClick={() => setNameExpanded((v) => !v)}
        class="py-3 border-t border-b border-border mt-2 text-left outline-none"
      >
        <span
          class="text-xs leading-none block"
          classList={{
            "truncate": !nameExpanded(),
            "break-all": nameExpanded(),
          }}
        >
          {selection.asset() ? assetName(selection.asset()!) : 'Untitled'}
        </span>
      </button>
      <div class="flex flex-col gap-1 my-2">
        <For each={metadataRows().filter((row) => row.value != null)}>
          {(row) => (
            <Switch>
              <Match when={row.label === "Prompt"}>
                <div class="flex flex-col gap-2 py-1 text-xs text-muted-foreground">
                  <span class="w-20 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    {row.label}
                  </span>
                  <span class="min-w-0 text-left wrap-break-words">
                    {row.value}
                  </span>
                </div>
              </Match>
              <Match when={row.label !== "Prompt"}>
                <div class="flex h-7 items-center gap-2 text-xs text-muted-foreground">
                  <span class="w-20 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    {row.label}
                  </span>
                  <span class="min-w-0 flex-1 text-right overflow-hidden text-ellipsis whitespace-nowrap" title={row.value ?? undefined}>
                    {row.value}
                  </span>
                </div>
              </Match>
            </Switch>
          )}
        </For>
      </div>
    </div>
  );
}

export function useAssetMetadataRows(asset: Accessor<Asset | undefined>) {
  const generationId = createMemo(() => asset()?.generation?.id ?? null);

  const [config] = createResource(() => generationId(), async (id) => {
    if (!id || !supabase) return undefined;
    const { data, error } = await supabase
      .from("usage_records")
      .select("config")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error("[asset-info] Failed to load generation record", error);
      return undefined;
    }
    return toClientConfig(data?.config);
  });

  return createMemo(() => {
    const a = asset();
    if (!a) return [];

    const visual = a.type === "IMAGE" || a.type === "VIDEO" || a.type === "SEQUENCE";
    const timed = a.type === "VIDEO" || a.type === "AUDIO" || a.type === "SEQUENCE";

    const dimensions = visual ? `${a.width}×${a.height}` : null;
    const resolution = a.type === "VIDEO" || a.type === "SEQUENCE" ? `${a.height}p` : null;
    const aspectRatio = visual ? formatAspectRatio(a.width, a.height) : null;
    const frameRate =
      a.type === "VIDEO" || a.type === "SEQUENCE"
        ? `${Math.round(a.frameRate)} FPS`
        : null;
    const duration = timed ? formatDuration(a.duration) : null;
    const fileSize = a.stat ? formatBytes(a.stat.size) : null;
    const format = formatMimeTypeLabel(a.mimeType);
    const channels =
      a.type === "AUDIO" || a.type === "VIDEO"
        ? formatChannels(a.channels)
        : null;
    const imported = formatAssetDate(a.createdAt);
    const modified = a.stat ? formatAssetDate(a.stat.mtime) : null;
    const c = config();
    const prompt = c?.prompt ?? null;
    const model = c?.model ?? null;

    return [
      { label: "Dimensions", value: dimensions },
      { label: "Resolution", value: resolution },
      { label: "Aspect ratio", value: aspectRatio },
      { label: "Frame rate", value: frameRate },
      { label: "Duration", value: duration },
      { label: "File size", value: fileSize },
      { label: "Format", value: format },
      { label: "Channels", value: channels },
      { label: "Imported", value: imported },
      { label: "Modified", value: modified },
      { label: "Source", value: a.source },
      { label: "Prompt", value: prompt },
      { label: "Model", value: model },
    ];
  });
}
