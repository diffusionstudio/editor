export const COMPANION_PROTOCOL_VERSION = 4;
export const COMPANION_SCHEMA_HASH = "diffusion-companion-v4-20260902";

export type CompanionCapabilities = {
  readOnly: true;
  browserDapi: false;
  cloudAi: false;
  persistentEdits: false;
  htmlPaint: false;
  media: "unsupported-phase-a";
  webgpu: "browser-dependent";
  fonts: "browser-dependent";
};

export type CompanionBundle =
  | { ok: true; code: string }
  | { ok: false; error: string };

export type CompanionSnapshot = {
  protocol: typeof COMPANION_PROTOCOL_VERSION;
  schemaHash: typeof COMPANION_SCHEMA_HASH;
  appVersion: string;
  buildHash: string;
  sessionId: string;
  revision: number;
  bundleHash: string;
  project: { id: string; name: string; displayName: string };
  bundle: CompanionBundle;
  capabilities: CompanionCapabilities;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} contains unsupported fields`);
  }
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a non-empty string`);
  return value;
}

/**
 * Runtime-validates and narrow-copies the complete Phase A wire envelope.
 * Exact keys are intentional: project manifests, configs, roots, paths, and
 * any future desktop metadata must be explicitly designed into a later
 * protocol rather than leaking through structural TypeScript casts.
 */
export function parseCompanionSnapshot(value: unknown): CompanionSnapshot {
  const snapshot = record(value, "Companion snapshot");
  exactKeys(snapshot, [
    "protocol", "schemaHash", "appVersion", "buildHash", "sessionId",
    "revision", "bundleHash", "project", "bundle", "capabilities",
  ], "Companion snapshot");
  if (snapshot.protocol !== COMPANION_PROTOCOL_VERSION) throw new Error("Companion protocol version mismatch");
  if (snapshot.schemaHash !== COMPANION_SCHEMA_HASH) throw new Error("Companion schema hash mismatch");
  if (!Number.isInteger(snapshot.revision) || (snapshot.revision as number) < 1) {
    throw new Error("Companion revision is invalid");
  }

  const project = record(snapshot.project, "Companion project");
  exactKeys(project, ["id", "name", "displayName"], "Companion project");

  const bundle = record(snapshot.bundle, "Companion bundle");
  if (bundle.ok === true) {
    exactKeys(bundle, ["ok", "code"], "Companion bundle");
    string(bundle.code, "Companion bundle code");
  } else if (bundle.ok === false) {
    exactKeys(bundle, ["ok", "error"], "Companion bundle");
    string(bundle.error, "Companion bundle error");
  } else {
    throw new Error("Companion bundle result is invalid");
  }

  const capabilities = record(snapshot.capabilities, "Companion capabilities");
  exactKeys(capabilities, [
    "readOnly", "browserDapi", "cloudAi", "persistentEdits", "htmlPaint",
    "media", "webgpu", "fonts",
  ], "Companion capabilities");
  if (
    capabilities.readOnly !== true || capabilities.browserDapi !== false ||
    capabilities.cloudAi !== false || capabilities.persistentEdits !== false ||
    capabilities.htmlPaint !== false || capabilities.media !== "unsupported-phase-a" ||
    capabilities.webgpu !== "browser-dependent" || capabilities.fonts !== "browser-dependent"
  ) {
    throw new Error("Companion capabilities are invalid");
  }

  return {
    protocol: COMPANION_PROTOCOL_VERSION,
    schemaHash: COMPANION_SCHEMA_HASH,
    appVersion: string(snapshot.appVersion, "Companion app version"),
    buildHash: string(snapshot.buildHash, "Companion build hash"),
    sessionId: string(snapshot.sessionId, "Companion session id"),
    revision: snapshot.revision as number,
    bundleHash: string(snapshot.bundleHash, "Companion bundle hash"),
    project: {
      id: string(project.id, "Companion project id"),
      name: string(project.name, "Companion project name"),
      displayName: string(project.displayName, "Companion project display name"),
    },
    bundle: bundle.ok === true
      ? { ok: true, code: bundle.code as string }
      : { ok: false, error: bundle.error as string },
    capabilities: {
      readOnly: true,
      browserDapi: false,
      cloudAi: false,
      persistentEdits: false,
      htmlPaint: false,
      media: "unsupported-phase-a",
      webgpu: "browser-dependent",
      fonts: "browser-dependent",
    },
  };
}

export type CompanionServerMessage =
  | { type: "bundle"; snapshot: CompanionSnapshot }
  | { type: "disconnected"; sessionId: string; reason: "socket-closed" | "stopped" }
  | { type: "stopped"; sessionId: string };

export type CompanionApplyAcknowledgement = {
  sessionId: string;
  revision: number;
  bundleHash: string;
  ok: boolean;
  error?: string;
};
