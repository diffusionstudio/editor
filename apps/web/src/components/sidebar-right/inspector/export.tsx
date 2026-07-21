/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createEffect, createMemo, createSignal, createUniqueId } from "solid-js";
import { PanelSection } from "@/components/ui/panel-section";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ItemRow } from "@/components/ui/item-row";
import { ControlRow } from "@/components/ui/control-group";
import {
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuItemDetail,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MenuIconButton } from "@/components/ui/menu-icon-button";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorSeparator,
  FloatingInspectorTitle,
  FloatingInspectorLayer,
} from "@/components/ui/floating-inspector";
import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch, SwitchControl, SwitchInput, SwitchThumb } from "@/components/ui/switch";

import { Separator } from "@/components/ui/separator";
import { SliderInput } from "@/components/ui/slider-input";
import { formatBytes, formatDuration } from "@/utils/formatters";
import { useEntityState, useEntityTag, setComponent, removeComponent } from "@/components/engine";
import { useEngine } from "@/context/engine";
import { useActiveInspector, useActiveInspectorInvalidation } from "./active-inspector";
import { useExport } from "@/context/export";
import { type ExportConfig } from "./export-progress";
import {
  EXPORT_TEMPLATE_GROUPS,
  TEMPLATE_BY_ID,
  RESOLUTION_OPTIONS,
  VIDEO_CODEC_OPTIONS,
  VIDEO_FORMAT_OPTIONS,
  FRAME_RATE_OPTIONS,
  AUDIO_CODEC_OPTIONS,
  SAMPLE_RATE_OPTIONS,
} from "./export-templates";

import type { EngineWorld } from "@/components/engine";
import type { ContainerFormat } from "@/components/engine/encode/types";
import type { VideoCodec, AudioCodec } from "mediabunny";

type ExportPanelProps = {
  selection: Set<number>;
};

export type ExportSettingsData = {
  templateId?: string | null;
  format?: ContainerFormat;
  videoEnabled?: boolean;
  videoCodec?: VideoCodec;
  videoBitrate?: number;
  videoFps?: number;
  videoResolution?: number;
  audioEnabled?: boolean;
  audioCodec?: AudioCodec;
  audioSampleRate?: number;
};

// Build the full export template payload — every field, so switching templates
// fully replaces the prior config (the observer clears fields a template omits).
function templatePayload(id: string): ExportSettingsData | null {
  const template = TEMPLATE_BY_ID.get(id);
  if (!template) return null;
  return {
    templateId: id,
    format: template.format,
    videoEnabled: template.video?.enabled,
    videoCodec: template.video?.codec,
    videoBitrate: template.video?.bitrate,
    videoFps: template.video?.fps,
    videoResolution: template.video?.resolution,
    audioEnabled: template.audio?.enabled,
    audioCodec: template.audio?.codec,
    audioSampleRate: template.audio?.sampleRate,
  };
}

// Read the export settings off the scene entity imperatively (no subscription).
function readConfig(world: EngineWorld, eid: number): ExportConfig | undefined {
  const s = world.components.ExportSettings;
  if (s.templateId[eid] == null) return undefined;
  return {
    format: s.format[eid],
    video: {
      enabled: s.videoEnabled[eid],
      codec: s.videoCodec[eid],
      bitrate: s.videoBitrate[eid],
      fps: s.videoFps[eid],
      resolution: s.videoResolution[eid],
    },
    audio: {
      enabled: s.audioEnabled[eid],
      codec: s.audioCodec[eid],
      sampleRate: s.audioSampleRate[eid],
    },
  };
}

const OWNER = "export";

export function ExportPanel(props: ExportPanelProps) {
  const { world } = useEngine();
  const { exportScene: runExport } = useExport();

  const c = world.components;

  const inspectors = useActiveInspector();
  const isInspectorOpen = () => inspectors.currentId(OWNER) !== undefined;

  const [search, setSearch] = createSignal("");
  const [config, setConfig] = createSignal<ExportConfig | undefined>();

  const eid = () => props.selection.values().next().value!;
  const duration = useEntityState(c.Computed.duration, eid, 0);
  const durationInSeconds = createMemo(() => duration() / world.frameRate);
  // Gate on component presence: removing a template removes the whole component,
  // but the SoA arrays aren't cleared, so the value subscription alone would
  // still report the old id.
  const hasSettings = useEntityTag(c.ExportSettings, eid);
  // Close the inspector if the settings disappear (remove, undo). The one-element
  // list gives the shared helper its confirmedId tolerance, matching the other sections.
  useActiveInspectorInvalidation(OWNER, () => (hasSettings() ? [eid()] : []));
  const templateId = useEntityState(c.ExportSettings.templateId, eid, null);
  const selectedTemplateId = () => (hasSettings() ? templateId() ?? null : null);

  const selectedTemplate = createMemo(() => {
    const id = selectedTemplateId();
    if (!id) return null;
    return TEMPLATE_BY_ID.get(id) ?? null;
  });

  createEffect(() => {
    setConfig(selectedTemplateId() ? readConfig(world, eid()) : undefined);
  });

  const writeSettings = (data: ExportSettingsData) => {
    setComponent(world, eid(), c.ExportSettings, data, false);
  };

  const setInspectorTemplate = (id?: string | null) => {
    if (!id) return;
    const payload = templatePayload(id);
    if (payload) writeSettings(payload);
    inspectors.open(OWNER, eid());
  };

  const filteredTemplateGroups = createMemo(() => {
    const query = search().trim().toLowerCase();

    return EXPORT_TEMPLATE_GROUPS
      .map((group) => ({
        id: group.id,
        label: group.label,
        items: group.items.filter((item) => {
          if (!query) return true;
          return `${item.name} ${item.video?.resolution} ${group.label}`
            .toLowerCase()
            .includes(query);
        }),
      }))
      .filter((group) => group.items.length > 0);
  });

  const exportScene = async () => {
    const template = selectedTemplate();
    if (!template) return;

    await runExport(eid(), readConfig(world, eid()) ?? template);
  };

  const estimatedFileSize = createMemo(() => {
    return estimateFileSize(config(), durationInSeconds());
  });

  let inspectorAnchorRef: HTMLDivElement | undefined;
  let sectionRef: HTMLDivElement | undefined;

  return (
    <>
    <div ref={sectionRef} class="contents">
    <PanelSection
      title="Export"
      ref={inspectorAnchorRef}
      actions={
        <MenuIconButton
          tooltip="Add template"
          aria-label="Add export template"
          placement="bottom-end"
          onOpenChange={(open) => {
            if (!open) setSearch("");
          }}
          class="text-muted-foreground"
          data-row-control=""
          icon={<Icon name="plus-add" />}
          contentClass="w-[208px]"
        >
          <div class="flex h-7 w-full items-center rounded-md overflow-hidden">
                <div class="h-7 w-6 shrink-0 flex items-center justify-center text-muted-foreground">
                  <Icon name="search" class="size-6" />
                </div>
                <input
                  type="text"
                  placeholder="Search"
                  value={search()}
                  onInput={(event) => setSearch(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") return;
                    event.stopPropagation();
                  }}
                  class="flex-1 min-w-0 bg-transparent pl-2 text-xs text-foreground placeholder:text-muted-foreground outline-none"
                />
              </div>
              <DropdownMenuSeparator />
              <For each={filteredTemplateGroups()}>
                {(group, index) => (
                  <>
                    <Show when={index() > 0}>
                      <DropdownMenuSeparator />
                    </Show>
                    <DropdownMenuGroup>
                      <DropdownMenuGroupLabel>
                        {group.label}
                      </DropdownMenuGroupLabel>
                      <For each={group.items}>
                        {(item) => (
                          <DropdownMenuItem
                            tone="neutral"
                            disabled={item.id === selectedTemplateId()}
                            onSelect={() => setInspectorTemplate(item.id)}
                          >
                            <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                              {item.name}
                            </span>
                            <DropdownMenuItemDetail>
                              {item.video?.resolution}p
                            </DropdownMenuItemDetail>
                          </DropdownMenuItem>
                        )}
                      </For>
                    </DropdownMenuGroup>
                  </>
                )}
              </For>
              <Show when={filteredTemplateGroups().length === 0}>
                <div class="px-2 py-1.5 text-xs text-muted-foreground">
                  No template found
                </div>
              </Show>
        </MenuIconButton>
      }
    >
      <Show when={selectedTemplate()}>
        {(template) => (
          <>
            <ItemRow
              value={`${template().name} · ${template().video?.resolution}p`}
              icon={<Icon name="film-video-export" />}
              onClick={() => inspectors.toggle(OWNER, eid())}
            >
              <Tooltip>
                <TooltipTrigger
                  as={Button}
                  size="icon"
                  variant="ghost"
                  class="text-muted-foreground"
                  onClick={() => {
                    removeComponent(world, eid(), c.ExportSettings, false);
                    inspectors.close(OWNER);
                  }}
                >
                  <Icon name="close-remove-small" />
                </TooltipTrigger>
                <TooltipContent>Remove template</TooltipContent>
              </Tooltip>
            </ItemRow>
            <Button class="w-full" onClick={exportScene}>
              Export
            </Button>
            <div class="flex justify-between items-center h-7">
              <span class="text-base text-muted-foreground">
                Duration {formatDuration(durationInSeconds())}
              </span>
              <span class="text-base text-muted-foreground">
                File size {formatBytes(estimatedFileSize())}
              </span>
            </div>
          </>
        )}
      </Show>
    </PanelSection>
    </div>

    <Show when={isInspectorOpen() && hasSettings()}>
      <ExportInspector
        eid={eid}
        anchorRef={inspectorAnchorRef}
        triggerRef={sectionRef}
        onClose={() => inspectors.close(OWNER)}
        onConfigChange={setConfig}
        onSelectTemplate={setInspectorTemplate}
      />
    </Show>
    </>
  );
}

type ExportInspectorProps = {
  eid: () => number;
  anchorRef: HTMLDivElement | undefined;
  triggerRef?: HTMLElement;
  onClose: () => void;
  onConfigChange: (config: ExportConfig | undefined) => void;
  onSelectTemplate: (id: string) => void;
};

// The floating export-settings dialog. Kept as its own component so the per-field
// value subscriptions below only exist while the dialog is mounted (i.e. open).
function ExportInspector(props: ExportInspectorProps) {
  const { world } = useEngine();
  const c = world.components;

  const titleId = createUniqueId();

  const templateId = useEntityState(c.ExportSettings.templateId, props.eid, null);
  const format = useEntityState(c.ExportSettings.format, props.eid, undefined);
  const videoEnabled = useEntityState(c.ExportSettings.videoEnabled, props.eid, undefined);
  const videoCodec = useEntityState(c.ExportSettings.videoCodec, props.eid, undefined);
  const videoBitrate = useEntityState(c.ExportSettings.videoBitrate, props.eid, undefined);
  const videoFps = useEntityState(c.ExportSettings.videoFps, props.eid, undefined);
  const videoResolution = useEntityState(c.ExportSettings.videoResolution, props.eid, undefined);
  const audioEnabled = useEntityState(c.ExportSettings.audioEnabled, props.eid, undefined);
  const audioCodec = useEntityState(c.ExportSettings.audioCodec, props.eid, undefined);
  const audioSampleRate = useEntityState(c.ExportSettings.audioSampleRate, props.eid, undefined);

  const selectedTemplate = createMemo(() => {
    const id = templateId();
    if (!id) return null;
    return TEMPLATE_BY_ID.get(id) ?? null;
  });

  const config = createMemo<ExportConfig | undefined>(() => {
    if (templateId() == null) return undefined;
    return {
      format: format(),
      video: {
        enabled: videoEnabled(),
        codec: videoCodec(),
        bitrate: videoBitrate(),
        fps: videoFps(),
        resolution: videoResolution(),
      },
      audio: {
        enabled: audioEnabled(),
        codec: audioCodec(),
        sampleRate: audioSampleRate(),
      },
    };
  });

  // Keep the panel's file-size estimate in sync while the dialog is open; the
  // last value stays frozen in the panel once this component unmounts.
  createEffect(() => props.onConfigChange(config()));

  const writeSettings = (data: ExportSettingsData) => {
    setComponent(world, props.eid(), c.ExportSettings, data, false);
  };

  return (
    <FloatingInspectorLayer
      onDismiss={props.onClose}
      triggerRef={props.triggerRef}
      triggerControlSelector="[data-row-control]"
      labelledBy={titleId}
    >
    <FloatingInspector open anchorRef={props.anchorRef} width={272}>
      <FloatingInspectorTitle id={titleId} class="sr-only">Export settings</FloatingInspectorTitle>
      <FloatingInspectorHeader class="items-center justify-between px-2">
        <Select
          value={selectedTemplate()?.id ?? ""}
          options={Array.from(TEMPLATE_BY_ID.values()).map((template) => template.id)}
          onChange={(value) => value && props.onSelectTemplate(value)}
          itemComponent={(itemProps) => {
            const template = TEMPLATE_BY_ID.get(itemProps.item.rawValue);
            return <SelectItem item={itemProps.item}>{template?.name}</SelectItem>;
          }}
        >
          <SelectTrigger>
            <SelectValue>
              {selectedTemplate()?.name}
            </SelectValue>
          </SelectTrigger>
          <SelectPortal>
            <SelectContent />
          </SelectPortal>
        </Select>
        <Tooltip>
          <TooltipTrigger
            as={Button}
            size="icon"
            variant="ghost"
            class="text-muted-foreground"
            onClick={() => props.onClose()}
          >
            <Icon name="close-remove" />
          </TooltipTrigger>
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
      </FloatingInspectorHeader>
      <FloatingInspectorSeparator />
      <FloatingInspectorContent class="p-4">
        <div class="flex flex-col gap-2">
          <ControlRow label="Video">
            <Switch
              checked={config()?.video?.enabled != false}
              onChange={(checked) => writeSettings({ videoEnabled: checked })}
            >
              <SwitchInput />
              <SwitchControl variant="compact">
                <SwitchThumb variant="compact" />
              </SwitchControl>
            </Switch>
          </ControlRow>
          <div
            class="flex flex-col gap-2 transition-opacity"
            classList={{
              "opacity-50": config()?.video?.enabled == false,
              "pointer-events-none": config()?.video?.enabled == false,
            }}
          >
            <ControlRow label="Resolution">
              <Select
                value={config()?.video?.resolution}
                options={[...RESOLUTION_OPTIONS]}
                onChange={(value) => writeSettings({ videoResolution: value ?? undefined })}
                itemComponent={(itemProps) => (
                  <SelectItem item={itemProps.item}>{itemProps.item.rawValue}p</SelectItem>
                )}
              >
                <SelectTrigger>
                  <SelectValue>{config()?.video?.resolution + 'p'}</SelectValue>
                </SelectTrigger>
                <SelectPortal>
                  <SelectContent />
                </SelectPortal>
              </Select>
            </ControlRow>
            <ControlRow label="Bitrate">
              <SliderInput
                value={((config()?.video?.bitrate ?? 10e6) / 1e6)}
                onChange={(value) => writeSettings({ videoBitrate: value * 1e6 })}
                min={0.1}
                max={120}
                step={1}
              />
            </ControlRow>
            <ControlRow label="Codec">
              <Select
                value={config()?.video?.codec ?? 'avc'}
                options={[...VIDEO_CODEC_OPTIONS]}
                onChange={(value) => writeSettings({ videoCodec: value ?? undefined })}
                itemComponent={(itemProps) => (
                  <SelectItem item={itemProps.item}>{itemProps.item.rawValue.toUpperCase()}</SelectItem>
                )}
              >
                <SelectTrigger>
                  <SelectValue>{config()?.video?.codec?.toUpperCase() ?? 'AVC'}</SelectValue>
                </SelectTrigger>
                <SelectPortal>
                  <SelectContent />
                </SelectPortal>
              </Select>
            </ControlRow>
            <ControlRow label="Format">
              <Select
                value={config()?.format ?? 'mp4'}
                options={[...VIDEO_FORMAT_OPTIONS]}
                onChange={(value) => writeSettings({ format: value ?? undefined })}
                itemComponent={(itemProps) => (
                  <SelectItem item={itemProps.item}>{itemProps.item.rawValue.toUpperCase()}</SelectItem>
                )}
              >
                <SelectTrigger>
                  <SelectValue>{config()?.format?.toUpperCase() ?? 'MP4'}</SelectValue>
                </SelectTrigger>
                <SelectPortal>
                  <SelectContent />
                </SelectPortal>
              </Select>
            </ControlRow>
            <ControlRow label="Frame rate">
              <Select
                value={config()?.video?.fps ?? 30}
                options={[...FRAME_RATE_OPTIONS]}
                onChange={(value) => writeSettings({ videoFps: value ?? undefined })}
                itemComponent={(itemProps) => (
                  <SelectItem item={itemProps.item}>{itemProps.item.rawValue} FPS</SelectItem>
                )}
              >
                <SelectTrigger>
                  <SelectValue>{config()?.video?.fps ?? 30} FPS</SelectValue>
                </SelectTrigger>
                <SelectPortal>
                  <SelectContent />
                </SelectPortal>
              </Select>
            </ControlRow>
          </div>
        </div>

        <Separator class="my-3" />

        <div class="flex flex-col gap-2">
          <ControlRow label="Audio">
            <Switch
              checked={config()?.audio?.enabled != false}
              onChange={(checked) => writeSettings({ audioEnabled: checked })}
            >
              <SwitchInput />
              <SwitchControl variant="compact">
                <SwitchThumb variant="compact" />
              </SwitchControl>
            </Switch>
          </ControlRow>
          <div
            class="flex flex-col gap-2 transition-opacity"
            classList={{
              "opacity-50": config()?.audio?.enabled == false,
              "pointer-events-none": config()?.audio?.enabled == false,
            }}
          >
            <ControlRow label="Codec">
              <Select
                value={config()?.audio?.codec ?? 'aac'}
                options={[...AUDIO_CODEC_OPTIONS]}
                onChange={(value) => writeSettings({ audioCodec: value ?? undefined })}
                itemComponent={(itemProps) => (
                  <SelectItem item={itemProps.item}>{itemProps.item.rawValue.toUpperCase()}</SelectItem>
                )}
              >
                <SelectTrigger>
                  <SelectValue>{config()?.audio?.codec?.toUpperCase() ?? 'AAC'}</SelectValue>
                </SelectTrigger>
                <SelectPortal>
                  <SelectContent />
                </SelectPortal>
              </Select>
            </ControlRow>
            <ControlRow label="Sample rate">
              <Select
                value={config()?.audio?.sampleRate ?? 48000}
                options={[...SAMPLE_RATE_OPTIONS]}
                onChange={(value) => writeSettings({ audioSampleRate: value ?? undefined })}
                itemComponent={(itemProps) => (
                  <SelectItem item={itemProps.item}>{itemProps.item.rawValue / 1000} kHz</SelectItem>
                )}
              >
                <SelectTrigger>
                  <SelectValue>{(config()?.audio?.sampleRate ?? 48000) / 1000} kHz</SelectValue>
                </SelectTrigger>
                <SelectPortal>
                  <SelectContent />
                </SelectPortal>
              </Select>
            </ControlRow>
          </div>
        </div>
      </FloatingInspectorContent>
    </FloatingInspector>
    </FloatingInspectorLayer>
  );
}


const DEFAULT_ESTIMATE_VIDEO_BITRATE = 10e6;
const DEFAULT_ESTIMATE_AUDIO_BITRATE = 128e3;
const DEFAULT_ESTIMATE_RESOLUTION = 1080;
const DEFAULT_ESTIMATE_FRAME_RATE = 30;

const VIDEO_CODEC_SIZE_FACTORS: Partial<Record<VideoCodec, number>> = {
  avc: 1,
  hevc: 0.72,
  vp9: 0.82,
  av1: 0.65,
  vp8: 1.15,
};

const AUDIO_CODEC_SIZE_FACTORS: Partial<Record<AudioCodec, number>> = {
  aac: 1,
  opus: 0.78,
};

const CONTAINER_SIZE_FACTORS: Record<ContainerFormat, number> = {
  mp4: 1,
  webm: 0.96,
  ogg: 0.93,
  mov: 1.03,
};

function estimateFileSize(config?: ExportConfig, duration?: number) {
  if (!duration || duration <= 0) return 0;

  const format = config?.format ?? "mp4";
  const videoEnabled = format === "ogg" ? false : config?.video?.enabled !== false;
  const audioEnabled = format === "ogg" ? true : config?.audio?.enabled !== false;

  const videoBitrate = config?.video?.bitrate ?? DEFAULT_ESTIMATE_VIDEO_BITRATE;
  const audioBitrate = config?.audio?.bitrate ?? DEFAULT_ESTIMATE_AUDIO_BITRATE;

  const resolution = Math.max(config?.video?.resolution ?? DEFAULT_ESTIMATE_RESOLUTION, 1);
  const fps = Math.max(config?.video?.fps ?? DEFAULT_ESTIMATE_FRAME_RATE, 1);

  const videoCodec = config?.video?.codec ?? "avc";
  const audioCodec = config?.audio?.codec ?? (format === "webm" || format === "ogg" ? "opus" : "aac");

  const videoCodecFactor = VIDEO_CODEC_SIZE_FACTORS[videoCodec] ?? 1;
  const audioCodecFactor = AUDIO_CODEC_SIZE_FACTORS[audioCodec] ?? 1;
  const containerFactor = CONTAINER_SIZE_FACTORS[format];

  const resolutionFactor = Math.pow(resolution / DEFAULT_ESTIMATE_RESOLUTION, 1.08);
  const frameRateFactor = fps / DEFAULT_ESTIMATE_FRAME_RATE;

  const effectiveVideoBitrate =
    videoBitrate * resolutionFactor * frameRateFactor * videoCodecFactor * containerFactor;
  const effectiveAudioBitrate = audioBitrate * audioCodecFactor * containerFactor;

  const totalBitrate =
    (videoEnabled ? effectiveVideoBitrate : 0) + (audioEnabled ? effectiveAudioBitrate : 0);

  return (duration * totalBitrate) / 8;
}
