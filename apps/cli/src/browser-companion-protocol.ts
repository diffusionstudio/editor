export type BrowserCompanionCapabilities = {
  readOnly: true;
  browserDapi: false;
  cloudAi: false;
  persistentEdits: false;
  htmlPaint: false;
  media: "unsupported-phase-a";
  webgpu: "browser-dependent";
  fonts: "browser-dependent";
  trustedProjectCode: true;
};

export type BrowserCompanionCommand =
  | { kind: "browser-companion"; action: "prepare"; projectDir: string }
  | { kind: "browser-companion"; action: "start"; projectDir: string; projectId?: string }
  | { kind: "browser-companion"; action: "status" }
  | { kind: "browser-companion"; action: "logs" }
  | { kind: "browser-companion"; action: "stop" };

export type BrowserCompanionLog = {
  seq: number;
  ts: number;
  level: "debug" | "info" | "warning" | "error";
  event: string;
  data?: Record<string, unknown>;
};

export type BrowserCompanionRevisionIdentity = {
  sessionId: string;
  revision: number;
  bundleHash: string;
};

export type BrowserCompanionStatus = {
  active: boolean;
  sessionId?: string;
  origin?: string;
  appVersion?: string;
  buildHash?: string;
  protocol?: number;
  project?: { id: string; name: string; displayName: string };
  rendererConnected?: boolean;
  hostWindowVisible?: boolean;
  hostWindowMode?: "hidden" | "minimized-fallback";
  hostLocalOnly?: boolean;
  revision?: number;
  bundleHash?: string;
  canonicalCompiled?: BrowserCompanionRevisionIdentity;
  hostApplied?: BrowserCompanionRevisionIdentity;
  browserApplied?: BrowserCompanionRevisionIdentity;
  lifecycle?: "awaiting-renderer" | "awaiting-host-apply" | "awaiting-browser-apply" | "ready" | "disconnected-fresh-session-required" | "failed";
  mountError?: string;
  egressAttempts?: number;
};

export type BrowserCompanionStart = BrowserCompanionStatus & {
  active: true;
  url: string;
  capabilities: BrowserCompanionCapabilities;
  humanStep: string;
};

export type BrowserCompanionReply =
  | { ok: true; data: BrowserCompanionStart | BrowserCompanionStatus | BrowserCompanionLog[] }
  | { ok: false; error: string };

export function isBrowserCompanionCommand(value: unknown): value is BrowserCompanionCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as { kind?: unknown; action?: unknown; projectDir?: unknown; projectId?: unknown };
  if (command.kind !== "browser-companion") return false;
  if (command.action !== "prepare" && command.action !== "start" && command.action !== "status" && command.action !== "logs" && command.action !== "stop") return false;
  const keys = Object.keys(value).sort();
  if (command.action !== "prepare" && command.action !== "start") {
    return keys.length === 2 && keys[0] === "action" && keys[1] === "kind";
  }
  const exactKeys = command.action === "prepare"
    ? keys.join(",") === "action,kind,projectDir"
    : keys.join(",") === "action,kind,projectDir" || keys.join(",") === "action,kind,projectDir,projectId";
  return exactKeys && typeof command.projectDir === "string" && command.projectDir.length > 0 && command.projectDir.length <= 32_768 && !command.projectDir.includes("\0") &&
    (command.action === "prepare" || command.projectId === undefined || (typeof command.projectId === "string" && command.projectId.length > 0 && command.projectId.length <= 256 && !command.projectId.includes("\0")));
}
