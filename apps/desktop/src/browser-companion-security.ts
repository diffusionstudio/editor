import { isAbsolute, relative } from "node:path";
import { timingSafeEqual } from "node:crypto";

export type CompanionAuthenticationExpectation = {
  capability: string;
  buildHash: string;
  protocol: number;
  schemaHash: string;
  appVersion: string;
  capabilityConsumed: boolean;
  rendererConnected: boolean;
};

export function exactCompanionOrigin(actual: string | undefined, expected: string): boolean {
  return actual === expected;
}

export function isLoopbackCompanionUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
  } catch {
    return false;
  }
}

export function containedWebPath(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function redactCompanionLog(text: string, sensitive: readonly string[]): string {
  let result = text;
  for (const value of sensitive) if (value) result = result.split(value).join("<redacted>");
  return result
    .replace(/\b(Bearer|Capability)\s+[A-Za-z0-9._~-]+/gi, "$1 <redacted>")
    .replace(/(?:\/Users|\/home|\/private|\/tmp|[A-Za-z]:\\)[^\s"']+/g, "<redacted-path>");
}

function sameSecret(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string") return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isCompanionAuthentication(value: unknown, expected: CompanionAuthenticationExpectation): boolean {
  if (!value || typeof value !== "object" || expected.capabilityConsumed || expected.rendererConnected) return false;
  const message = value as { type?: unknown; capability?: unknown; buildHash?: unknown; client?: unknown };
  if (message.type !== "authenticate" || !sameSecret(message.capability, expected.capability) || message.buildHash !== expected.buildHash) return false;
  if (!message.client || typeof message.client !== "object") return false;
  const client = message.client as { protocol?: unknown; schemaHash?: unknown; appVersion?: unknown };
  return client.protocol === expected.protocol && client.schemaHash === expected.schemaHash && client.appVersion === expected.appVersion;
}

export function isCompanionSemantic(value: unknown): value is "playback.play" | "playback.pause" | "playback.scrub" {
  return value === "playback.play" || value === "playback.pause" || value === "playback.scrub";
}
