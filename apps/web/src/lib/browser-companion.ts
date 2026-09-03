import { createSignal } from "solid-js";
import {
  COMPANION_PROTOCOL_VERSION,
  COMPANION_SCHEMA_HASH,
  parseCompanionSnapshot,
  type CompanionServerMessage,
  type CompanionSnapshot,
  type CompanionApplyAcknowledgement,
} from "./companion-protocol";
import { browserCompanionAuthority, isBrowserCompanionRenderer } from "./companion-authority";

const [snapshot, setSnapshot] = createSignal<CompanionSnapshot | null>(null);
const [error, setError] = createSignal<string | null>(null);
const listeners = new Set<(message: CompanionServerMessage) => void>();
let initialized: Promise<CompanionSnapshot | null> | null = null;

function validate(value: CompanionSnapshot): CompanionSnapshot {
  const parsed = parseCompanionSnapshot(value);
  if (parsed.appVersion !== APP_VERSION) throw new Error(`Companion app version mismatch (${parsed.appVersion} vs ${APP_VERSION})`);
  if (parsed.buildHash !== browserCompanionAuthority?.expectedBuildHash) throw new Error("Companion web build hash mismatch");
  if (!/^[a-f0-9]{64}$/.test(parsed.bundleHash)) throw new Error("Companion bundle hash is invalid");
  return parsed;
}

export function initializeBrowserCompanion(): Promise<CompanionSnapshot | null> {
  if (initialized) return initialized;
  const authority = browserCompanionAuthority;
  if (!authority) return Promise.resolve(null);

  initialized = authority
    .connect({ protocol: COMPANION_PROTOCOL_VERSION, schemaHash: COMPANION_SCHEMA_HASH, appVersion: APP_VERSION })
    .then((value) => {
      const next = validate(value);
      setSnapshot(next);
      authority.subscribe((message) => {
        if (message.type === "bundle") {
          try { setSnapshot(validate(message.snapshot)); }
          catch (cause) { setError((cause as Error).message); }
        } else if (message.type === "disconnected" || message.type === "stopped") {
          setError("Disconnected; start a fresh browser companion session");
        }
        for (const listener of listeners) listener(message);
      });
      return next;
    })
    .catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    });
  return initialized;
}

export const companionSnapshot = snapshot;
export const companionError = error;

export function onCompanionMessage(listener: (message: CompanionServerMessage) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function reportCompanionSemantic(event: "playback.play" | "playback.pause" | "playback.scrub", data: { time: number }): void {
  browserCompanionAuthority?.semantic(event, data);
}

export function reportCompanionApplied(acknowledgement: CompanionApplyAcknowledgement): void {
  browserCompanionAuthority?.applied(acknowledgement);
}

export { isBrowserCompanionRenderer };
