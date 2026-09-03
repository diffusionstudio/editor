/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createMemo, createResource, createSignal } from "solid-js";
import { canEncodeVideo, getEncodableAudioCodecs } from "mediabunny";
import { audioCodecsForFormat, computeOutputSize, resolveAudioCodec } from "@diffusionstudio/encoder";
import { PanelSection } from "@/components/ui/panel-section";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ItemRow } from "@/components/ui/item-row";
import { ControlRow } from "@/components/ui/control-group";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorSeparator,
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
import { useTrait, useWorld } from "@diffusionstudio/koota-solid";
import { Computed, FrameRate, Source } from "@diffusionstudio/runtime";
import { useDerived } from "@/engine/hooks";
import { useProjectConfig } from "@/engine/project-config";
import { useExport } from "@/context/export";
import {
  DEFAULT_EXPORT_TEMPLATE_ID,
  TEMPLATE_BY_ID,
  RESOLUTION_OPTIONS,
  VIDEO_CODEC_OPTIONS,
  VIDEO_FORMAT_OPTIONS,
  FRAME_RATE_OPTIONS,
  AUDIO_CODEC_OPTIONS,
  SAMPLE_RATE_OPTIONS,
} from "./export-templates";

import type { Entity } from "koota";
import type { VideoCodec, AudioCodec } from "mediabunny";
import type { ContainerFormat, ExportConfig as ProjectExportConfig } from "@/engine/project-config";
import type { ExportConfig } from "./export-templates";

type ExportPanelProps = {
  selection: Entity[];
};

/**
 * One entry of the resolution picker: the stored setting (a target height)
 * together with the pixel size it works out to for this scene, so the picker
 * names what the file will actually be.
 */
type ResolutionOption = {
  resolution: number;
  width: number;
  height: number;
  /** 1× — the scene's own size. */
  native: boolean;
};

/** The right-hand tag of a picker entry, set like a menu shortcut. */
function resolutionTag(option: ResolutionOption): string {
  return option.native ? "Original" : `${option.resolution}p`;
}

function resolutionLabel(option: ResolutionOption | null | undefined): string {
  if (!option) return "";
  return `${option.width}×${option.height} · ${resolutionTag(option)}`;
}

/** The whole settings a template stands for: every field, so it replaces what was there. */
function templateSettings(id: string): ProjectExportConfig | null {
  const template = TEMPLATE_BY_ID.get(id);
  if (!template) return null;
  return {
    template: id,
    format: template.format,
    video: template.video && { ...template.video },
    audio: template.audio && { ...template.audio },
  };
}

/**
 * How the selected scene is exported. Project configuration rather than
 * part of the composition: read from and written through the project config
 * (package.json `diffusion.export.<scene id>`, see
 * `@/engine/project-config`). The row and the floating inspector both read
 * the same accessor, so they never disagree.
 */
export function ExportPanel(props: ExportPanelProps) {
  const world = useWorld();
  const config = useProjectConfig();
  const { exportScene, exporting } = useExport();
  const entity = () => props.selection[0]!;

  const [isInspectorOpen, setIsInspectorOpen] = createSignal(false);

  const source = useTrait(() => entity(), Source);
  const settings = createMemo(() => {
    source();
    return config()?.exportOf(entity()) ?? undefined;
  });
  const frameRate = useTrait(world, FrameRate);
  const duration = useDerived(() => entity().get(Computed)?.duration ?? 0);
  const durationInSeconds = createMemo(() => duration() / (frameRate()?.value ?? 30));
  const sceneWidth = useDerived(() => entity().get(Computed)?.width || 1920);
  const sceneHeight = useDerived(() => entity().get(Computed)?.height || 1080);

  const template = createMemo(() => {
    const id = settings()?.template;
    return id ? TEMPLATE_BY_ID.get(id) ?? null : null;
  });

  const resolutionOptions = createMemo<ResolutionOption[]>(() => {
    const w = sceneWidth();
    const h = sceneHeight();
    // A resolution names the output's shorter side (the "p" number — for a
    // vertical scene, its width), so a portrait scene still offers 720p–4K.
    const shortSide = Math.min(w, h);
    return [...new Set([...RESOLUTION_OPTIONS, shortSide])].sort((a, b) => a - b).map((resolution) => ({
      resolution,
      ...computeOutputSize(w, h, resolution),
      native: resolution === shortSide,
    }));
  });

  const selectedResolution = createMemo(() => {
    const resolution = settings()?.video?.resolution ?? 1080;
    const match = resolutionOptions().find((option) => option.resolution === resolution);
    if (match) return match;
    const w = sceneWidth();
    const h = sceneHeight();
    return { resolution, ...computeOutputSize(w, h, resolution), native: resolution === Math.min(w, h) };
  });

  const [encodable] = createResource(
    () => {
      const current = settings();
      const size = selectedResolution();
      if (!current || !size) return undefined;
      if (current.format === "ogg" || current.video?.enabled === false) return undefined;
      return {
        codec: current.video?.codec ?? ("avc" as const),
        bitrate: current.video?.bitrate ?? 10e6,
        width: size.width,
        height: size.height,
      };
    },
    ({ codec, bitrate, width, height }) => canEncodeVideo(codec, { width, height, bitrate }),
  );

  // Which audio codecs are worth offering: those the container takes and
  // this browser can encode. AAC is a platform encoder in WebCodecs
  // (AudioToolbox on macOS, Media Foundation on Windows) and simply absent
  // on Linux, so offering it there would only fail the export.
  const [audioCodecs] = createResource(
    () => {
      const current = settings();
      return {
        format: current?.format ?? ("mp4" as const),
        sampleRate: current?.audio?.sampleRate,
        bitrate: current?.audio?.bitrate,
      };
    },
    async ({ format, ...options }) => {
      const [supported, encodable] = await Promise.all([
        audioCodecsForFormat(format),
        getEncodableAudioCodecs([...AUDIO_CODEC_OPTIONS], options),
      ]);
      return encodable.filter((codec) => supported.includes(codec));
    },
  );

  // Audio-only exports always encode
  const exportSupported = createMemo(() => {
    const current = settings();
    if (!current || current.format === "ogg" || current.video?.enabled === false) return true;
    return encodable() !== false;
  });

  // What the row says: the preset's name, or "Custom" for settings authored
  // without one, and the pixel size the export actually produces (a preset's
  // resolution can be changed in the inspector without leaving the preset).
  const label = createMemo(() => {
    const current = settings();
    if (!current) return "";
    const name = template()?.name ?? "Custom";
    const size = selectedResolution();
    return size ? `${name} · ${size.width}×${size.height}` : name;
  });

  const write = (value: ProjectExportConfig | null) => {
    void config()?.setExport(entity(), value);
  };

  // Replaces the settings with a preset's, wholesale. A preset names AAC for
  // mp4, which is a preference rather than a demand — what is written is the
  // codec this browser can encode into the container.
  const applyTemplate = async (id: string) => {
    const next = templateSettings(id);
    if (!next) return;
    const codec = await resolveAudioCodec(next.format, next.audio?.codec, {
      sampleRate: next.audio?.sampleRate,
      bitrate: next.audio?.bitrate,
    });
    write(codec ? { ...next, audio: { ...next.audio, codec } } : next);
  };

  const addSettings = () => {
    void applyTemplate(DEFAULT_EXPORT_TEMPLATE_ID);
    setIsInspectorOpen(true);
  };

  // Changes some fields, keeping the rest (and the preset label) as they are.
  const patchSettings = (patch: ExportConfig) => {
    const current = settings();
    if (!current) return;
    write({
      ...current,
      ...patch,
      video: patch.video ? { ...current.video, ...patch.video } : current.video,
      audio: patch.audio ? { ...current.audio, ...patch.audio } : current.audio,
    });
  };

  const removeSettings = () => {
    write(null);
    setIsInspectorOpen(false);
  };

  // The settings are already the encoder's shape; `template` is the panel's
  // own label for them and no part of how the file is made.
  const runExport = () => {
    const current = settings();
    if (!current) return;
    exportScene(entity(), {
      format: current.format,
      video: current.video,
      audio: current.audio,
    });
  };

  const estimatedFileSize = createMemo(() => {
    const size = selectedResolution();
    return estimateFileSize(settings(), durationInSeconds(), size ? size.width * size.height : undefined);
  });

  let inspectorAnchorRef: HTMLDivElement | undefined;

  return (
    <PanelSection
      title="Export"
      ref={inspectorAnchorRef}
      actions={
        <Show when={!settings()}>
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={addSettings}
            >
              <Icon name="plus-add" />
            </TooltipTrigger>
            <TooltipContent>Add export</TooltipContent>
          </Tooltip>
        </Show>
      }
    >
      <Show when={settings()}>
        <ItemRow
          value={label()}
          icon={<Icon name="film-video-export" />}
          onClick={() => setIsInspectorOpen(true)}
        >
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={removeSettings}
            >
              <Icon name="close-remove-small" />
            </TooltipTrigger>
            <TooltipContent>Remove export</TooltipContent>
          </Tooltip>
        </ItemRow>
        <Tooltip disabled={exportSupported()}>
          <TooltipTrigger as="div" class="w-full">
            <Button class="w-full" onClick={runExport} disabled={exporting() || !exportSupported()}>
              Export
            </Button>
          </TooltipTrigger>
          <TooltipContent class="max-w-64">
            This browser cannot encode {(settings()?.video?.codec ?? "avc").toUpperCase()} at{" "}
            {selectedResolution()?.width}×{selectedResolution()?.height}. Choose a lower
            resolution, a lower bitrate, or another codec.
          </TooltipContent>
        </Tooltip>
        <div class="flex justify-between items-center h-7">
          <span class="text-base text-muted-foreground">
            Duration {formatDuration(durationInSeconds())}
          </span>
          <span class="text-base text-muted-foreground">
            File size {formatBytes(estimatedFileSize())}
          </span>
        </div>
      </Show>
      <Show when={isInspectorOpen() && settings()}>
        {(current) => (
          <ExportInspector
            settings={current()}
            resolutionOptions={resolutionOptions()}
            selectedResolution={selectedResolution()}
            audioCodecOptions={audioCodecs() ?? AUDIO_CODEC_OPTIONS}
            anchorRef={inspectorAnchorRef}
            onClose={() => setIsInspectorOpen(false)}
            onSelectTemplate={applyTemplate}
            onPatch={patchSettings}
          />
        )}
      </Show>
    </PanelSection>
  );
}

type ExportInspectorProps = {
  settings: ProjectExportConfig;
  resolutionOptions: ResolutionOption[];
  selectedResolution: ResolutionOption | null;
  audioCodecOptions: AudioCodec[];
  anchorRef: HTMLDivElement | undefined;
  onClose: () => void;
  onSelectTemplate: (id: string) => void;
  onPatch: (patch: ExportConfig) => void;
};

/**
 * The floating export-settings dialog. Reads the settings the panel hands it
 * and writes through the panel, so there is one place they are written from.
 */
function ExportInspector(props: ExportInspectorProps) {
  const config = () => props.settings;
  const templateId = () => props.settings.template ?? "";

  const write = props.onPatch;

  return (
    <FloatingInspector open anchorRef={props.anchorRef} width={272}>
      <FloatingInspectorHeader class="items-center justify-between px-2">
        <Select
          value={templateId()}
          options={Array.from(TEMPLATE_BY_ID.keys())}
          onChange={(value) => value && props.onSelectTemplate(value)}
          itemComponent={(itemProps) => {
            const template = TEMPLATE_BY_ID.get(itemProps.item.rawValue);
            return <SelectItem item={itemProps.item}>{template?.name}</SelectItem>;
          }}
        >
          <SelectTrigger>
            <SelectValue>
              {TEMPLATE_BY_ID.get(templateId())?.name ?? "Custom"}
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
              checked={config().video?.enabled != false}
              onChange={(checked) => write({ video: { enabled: checked } })}
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
              "opacity-50": config().video?.enabled == false,
              "pointer-events-none": config().video?.enabled == false,
            }}
          >
            <ControlRow label="Resolution">
              <Select<ResolutionOption>
                value={props.selectedResolution ?? undefined}
                options={props.resolutionOptions}
                optionValue="resolution"
                optionTextValue={resolutionLabel}
                onChange={(value) => value && write({ video: { resolution: value.resolution } })}
                itemComponent={(itemProps) => {
                  const option = itemProps.item.rawValue;
                  return (
                    <SelectItem item={itemProps.item}>
                      <div class="flex min-w-0 flex-1 items-center">
                        <span>{option.width}×{option.height}</span>
                        <span class="ml-auto pl-3 text-xxs text-muted-foreground group-[[data-highlighted]]:text-[inherit]">
                          {resolutionTag(option)}
                        </span>
                      </div>
                    </SelectItem>
                  );
                }}
              >
                <SelectTrigger>
                  <SelectValue<ResolutionOption>>
                    <Show when={props.selectedResolution}>
                      {(selected) => (
                        <>
                          <span>{selected().width}×{selected().height}</span>
                          <span class="ml-auto text-xxs text-muted-foreground">
                            {resolutionTag(selected())}
                          </span>
                        </>
                      )}
                    </Show>
                  </SelectValue>
                </SelectTrigger>
                <SelectPortal>
                  <SelectContent />
                </SelectPortal>
              </Select>
            </ControlRow>
            <ControlRow label="Bitrate">
              <SliderInput
                value={(config().video?.bitrate ?? 10e6) / 1e6}
                onChange={(value) => write({ video: { bitrate: value * 1e6 } })}
                min={0.1}
                max={120}
                step={1}
              />
            </ControlRow>
            <ControlRow label="Codec">
              <Select
                value={config().video?.codec ?? "avc"}
                options={[...VIDEO_CODEC_OPTIONS]}
                onChange={(value) => value && write({ video: { codec: value } })}
                itemComponent={(itemProps) => (
                  <SelectItem item={itemProps.item}>{itemProps.item.rawValue.toUpperCase()}</SelectItem>
                )}
              >
                <SelectTrigger>
                  <SelectValue>{(config().video?.codec ?? "avc").toUpperCase()}</SelectValue>
                </SelectTrigger>
                <SelectPortal>
                  <SelectContent />
                </SelectPortal>
              </Select>
            </ControlRow>
            <ControlRow label="Format">
              <Select
                value={config().format ?? "mp4"}
                options={[...VIDEO_FORMAT_OPTIONS]}
                onChange={(value) => value && write({ format: value })}
                itemComponent={(itemProps) => (
                  <SelectItem item={itemProps.item}>{itemProps.item.rawValue.toUpperCase()}</SelectItem>
                )}
              >
                <SelectTrigger>
                  <SelectValue>{(config().format ?? "mp4").toUpperCase()}</SelectValue>
                </SelectTrigger>
                <SelectPortal>
                  <SelectContent />
                </SelectPortal>
              </Select>
            </ControlRow>
            <ControlRow label="Frame rate">
              <Select
                value={config().video?.fps ?? 30}
                options={[...FRAME_RATE_OPTIONS]}
                onChange={(value) => value && write({ video: { fps: value } })}
                itemComponent={(itemProps) => (
                  <SelectItem item={itemProps.item}>{itemProps.item.rawValue} FPS</SelectItem>
                )}
              >
                <SelectTrigger>
                  <SelectValue>{config().video?.fps ?? 30} FPS</SelectValue>
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
              checked={config().audio?.enabled != false}
              onChange={(checked) => write({ audio: { enabled: checked } })}
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
              "opacity-50": config().audio?.enabled == false,
              "pointer-events-none": config().audio?.enabled == false,
            }}
          >
            <ControlRow label="Codec">
              <Select
                value={config().audio?.codec ?? "aac"}
                options={[...props.audioCodecOptions]}
                onChange={(value) => value && write({ audio: { codec: value } })}
                itemComponent={(itemProps) => (
                  <SelectItem item={itemProps.item}>{itemProps.item.rawValue.toUpperCase()}</SelectItem>
                )}
              >
                <SelectTrigger>
                  <SelectValue>{(config().audio?.codec ?? "aac").toUpperCase()}</SelectValue>
                </SelectTrigger>
                <SelectPortal>
                  <SelectContent />
                </SelectPortal>
              </Select>
            </ControlRow>
            <ControlRow label="Sample rate">
              <Select
                value={config().audio?.sampleRate ?? 48000}
                options={[...SAMPLE_RATE_OPTIONS]}
                onChange={(value) => value && write({ audio: { sampleRate: value } })}
                itemComponent={(itemProps) => (
                  <SelectItem item={itemProps.item}>{itemProps.item.rawValue / 1000} kHz</SelectItem>
                )}
              >
                <SelectTrigger>
                  <SelectValue>{(config().audio?.sampleRate ?? 48000) / 1000} kHz</SelectValue>
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
  );
}

const DEFAULT_ESTIMATE_VIDEO_BITRATE = 10e6;
const DEFAULT_ESTIMATE_AUDIO_BITRATE = 128e3;
const DEFAULT_ESTIMATE_RESOLUTION = 1080;
const DEFAULT_ESTIMATE_PIXELS = 1920 * 1080;
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

function estimateFileSize(config?: ExportConfig, duration?: number, outputPixels?: number) {
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

  // Scaled by pixel count when the actual output size is known (for 16:9
  // content the two expressions agree); the height-only fallback stays for
  // callers with nothing but the config.
  const resolutionFactor = outputPixels
    ? Math.pow(outputPixels / DEFAULT_ESTIMATE_PIXELS, 0.54)
    : Math.pow(resolution / DEFAULT_ESTIMATE_RESOLUTION, 1.08);
  const frameRateFactor = fps / DEFAULT_ESTIMATE_FRAME_RATE;

  const effectiveVideoBitrate =
    videoBitrate * resolutionFactor * frameRateFactor * videoCodecFactor * containerFactor;
  const effectiveAudioBitrate = audioBitrate * audioCodecFactor * containerFactor;

  const totalBitrate =
    (videoEnabled ? effectiveVideoBitrate : 0) + (audioEnabled ? effectiveAudioBitrate : 0);

  return (duration * totalBitrate) / 8;
}
