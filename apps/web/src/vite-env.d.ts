/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/// <reference types="vite/client" />
/// <reference types="vite-plugin-solid-svg/types-component-solid" />
/// <reference types="@types/chrome" />
/// <reference types="user-agent-data-types" />

declare global {
  const APP_VERSION: string;
  interface Window {
    queryLocalFonts(query?: Record<string, any>): FontData[];
    chrome: any;
    desktop?: {
      platform: string;
      browserCompanionHost: boolean;
      send(channel: string, payload: unknown): void;
      on(channel: string, cb: (payload: unknown) => void): (() => void);
      getPathForFile(file: File): string;
    };
    readonly browserCompanion?: Readonly<{
      readonly enabled: true;
      readonly localOnly: true;
      readonly expectedBuildHash: string;
      connect(client: { protocol: number; schemaHash: string; appVersion: string }): Promise<import("./lib/companion-protocol").CompanionSnapshot>;
      subscribe(handler: (message: import("./lib/companion-protocol").CompanionServerMessage) => void): () => void;
      semantic(event: string, data: Record<string, unknown>): void;
      applied(acknowledgement: import("./lib/companion-protocol").CompanionApplyAcknowledgement): void;
      recordOutboundAttempt(kind: string, target: string): void;
    }>;
    showDirectoryPicker(options?: { mode?: "read" | "readwrite" }): Promise<FileSystemDirectoryHandle>;
    showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
    EyeDropper?: {
      new(): EyeDropper;
    };
  }

  interface OpenFilePickerOptions {
    multiple?: boolean;
    startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' | FileSystemHandle;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
    excludeAcceptAllOption?: boolean;
  }
  interface EyeDropperOpenResult {
    sRGBHex: string;
  }
  interface EyeDropper {
    open(options?: { signal?: AbortSignal }): Promise<EyeDropperOpenResult>;
  }
  interface VideoEncoder {
    ondequeue(): void;
  }
  interface VideoDecoder {
    ondequeue(): void;
  }
  interface FileSystemHandle {
    remove(): Promise<void>;
  }
}

export type { };
