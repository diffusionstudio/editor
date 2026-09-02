import { app, type BrowserWindow } from "electron";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, watch, type FSWatcher } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { WebSocketServer, WebSocket } from "ws";

import {
  COMPANION_PROTOCOL_VERSION,
  COMPANION_SCHEMA_HASH,
  type CompanionCapabilities,
  type CompanionSnapshot,
} from "../../web/src/lib/companion-protocol";
import {
  getProject,
} from "./projects";
import {
  containedWebPath,
  exactCompanionOrigin,
  isCompanionAuthentication,
  isCompanionSemantic,
  redactCompanionLog,
} from "./browser-companion-security";
import { OneShotCapture } from "./browser-companion-capture";

import type {
  BrowserCompanionCommand,
  BrowserCompanionLog,
  BrowserCompanionReply,
  BrowserCompanionStart,
  BrowserCompanionStatus,
} from "@diffusionstudio/cli/protocol";
import type { CompileResult, ProjectInfo } from "./main-channels";

const MAX_LOGS = 2000;
const MAX_RENDERER_MESSAGE = 1024 * 1024;
const CAPABILITIES: CompanionCapabilities = {
  readOnly: true,
  browserDapi: false,
  cloudAi: false,
  persistentEdits: false,
  htmlPaint: false,
  media: "unsupported-phase-a",
  webgpu: "browser-dependent",
  fonts: "browser-dependent",
};

type RevisionIdentity = { sessionId: string; revision: number; bundleHash: string };
type HostApplication = { root: string; sessionId: string; revision: number; bundleHash: string; ok: boolean; error?: string };
type PendingUpdate = { identity: RevisionIdentity; snapshot: CompanionSnapshot };

type Session = {
  id: string;
  root: string;
  project: ProjectInfo;
  capability: string;
  buildHash: string;
  origin: string;
  revision: number;
  canonicalCompiled: RevisionIdentity;
  hostApplied: RevisionIdentity;
  browserApplied: RevisionIdentity | null;
  pendingUpdate: PendingUpdate | null;
  mountError: string | null;
  snapshot: CompanionSnapshot;
  http: Server;
  websocket: WebSocketServer;
  renderer: WebSocket | null;
  rendererEverConnected: boolean;
  capabilityConsumed: boolean;
  watcher: FSWatcher | null;
  stopped: boolean;
  canonicalGeneration: number;
  updateChain: Promise<void>;
  egressAttempts: number;
  logs: BrowserCompanionLog[];
  logSequence: number;
  dockWasVisible: boolean;
  hostWindowMode: "hidden" | "minimized-fallback";
};

let current: Session | null = null;
let getHostWindow: () => BrowserWindow | null = () => null;
let prepareHost: () => Promise<void> = async () => {};
let releaseHost: () => Promise<void> = async () => {};
let hostPrepared = false;
let pendingHostEgress: string[] = [];
let canonicalGeneration = 0;
let preparedSession: { root: string; sessionId: string } | null = null;
type CanonicalBundle = {
  bundle: CompileResult;
  bundleHash: string;
  generation: number;
  durationMs: number;
  identity: RevisionIdentity;
};
const canonicalCapture = new OneShotCapture<CanonicalBundle>();
const hostApplicationCapture = new OneShotCapture<HostApplication>();

function bundleHash(bundle: CompileResult): string {
  return createHash("sha256").update(bundle.ok ? bundle.code : `compile-error:\n${bundle.error}`).digest("hex");
}

export async function publishBrowserCompanionBundle(
  root: string,
  bundle: CompileResult,
  durationMs: number,
): Promise<RevisionIdentity | null> {
  const session = current;
  const relayToSession = !!session && session.root === root && !session.stopped;
  // Normal desktop compilation is unchanged, but companion code retains no
  // result unless a start explicitly armed this root or an active companion
  // needs the watch update relayed.
  const armedForStart = canonicalCapture.isArmedFor(root);
  if (!armedForStart && !relayToSession) return null;

  const compiledBundleHash = bundleHash(bundle);
  const generation = ++canonicalGeneration;

  if (!relayToSession || !session) {
    if (!preparedSession || preparedSession.root !== root) {
      throw new Error("Companion surface capture has no prepared session identity");
    }
    const identity = { sessionId: preparedSession.sessionId, revision: 1, bundleHash: compiledBundleHash };
    canonicalCapture.publish(root, {
      bundle,
      bundleHash: compiledBundleHash,
      generation,
      durationMs,
      identity,
    });
    return identity;
  }

  const publication = session.updateChain.then(async (): Promise<RevisionIdentity | null> => {
    if (session.stopped || generation <= session.canonicalGeneration) return null;
    session.canonicalGeneration = generation;
    session.revision++;
    const identity = { sessionId: session.id, revision: session.revision, bundleHash: compiledBundleHash };
    session.canonicalCompiled = identity;
    session.pendingUpdate = {
      identity,
      snapshot: await makeSnapshot(session, bundle, compiledBundleHash, session.revision),
    };
    session.mountError = bundle.ok ? null : "Canonical project compile failed";
    log(session, bundle.ok ? "canonicalCompiled" : "canonicalCompileFailed", bundle.ok ? "info" : "error", {
      ...identity,
      durationMs,
    });
    if (!bundle.ok && session.renderer?.readyState === WebSocket.OPEN) {
      session.renderer.send(JSON.stringify({ type: "fatal", error: "Canonical project compile failed; companion stopped applying updates" }));
      session.renderer.close(1011, "Canonical compile failed");
    }
    return identity;
  });
  session.updateChain = publication.then(
    () => undefined,
    (error) => log(session, "project.bundle.relay.failed", "error", {
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  return publication;
}

/** Exact hidden-renderer mount acknowledgement for the compiled bundle. */
export function acknowledgeBrowserCompanionHostBundle(
  root: string,
  acknowledgement: { sessionId: string; revision: number; bundleHash: string; ok: boolean; error?: string },
): void {
  const application: HostApplication = { root, ...acknowledgement };
  hostApplicationCapture.publish(root, application);

  const session = current;
  if (!session || session.stopped || session.root !== root) return;
  session.updateChain = session.updateChain.then(() => {
    const pending = session.pendingUpdate;
    if (
      !pending ||
      pending.identity.sessionId !== acknowledgement.sessionId ||
      pending.identity.revision !== acknowledgement.revision ||
      pending.identity.bundleHash !== acknowledgement.bundleHash
    ) {
      log(session, "hostApplyRefused", "warning", {
        sessionId: acknowledgement.sessionId,
        revision: acknowledgement.revision,
        bundleHash: acknowledgement.bundleHash,
      });
      return;
    }
    if (!acknowledgement.ok) {
      session.mountError = redactCompanionLog(acknowledgement.error ?? "Hidden host mount failed", [session.root, session.capability]);
      log(session, "hostApplyFailed", "error", {
        revision: pending.identity.revision,
        bundleHash: pending.identity.bundleHash,
        message: session.mountError,
      });
      if (session.renderer?.readyState === WebSocket.OPEN) {
        session.renderer.send(JSON.stringify({ type: "fatal", error: "Hidden host failed to mount the canonical bundle" }));
        session.renderer.close(1011, "Hidden host mount failed");
      }
      return;
    }
    session.hostApplied = pending.identity;
    session.snapshot = pending.snapshot;
    session.pendingUpdate = null;
    session.mountError = null;
    log(session, "hostApplied", "info", pending.identity);
    if (session.renderer?.readyState === WebSocket.OPEN) {
      session.renderer.send(JSON.stringify({ type: "bundle", snapshot: session.snapshot }));
    }
  }).catch((error) => log(session, "hostApplyRelayFailed", "error", {
    message: error instanceof Error ? error.message : String(error),
  }));
}

export function resetBrowserCompanionHostEgressAudit(): void {
  pendingHostEgress = [];
}

export function recordBrowserCompanionHostEgress(url: string): void {
  let target = "invalid-url";
  try { target = new URL(url).origin; } catch { /* redacted semantic target only */ }
  if (current) {
    current.egressAttempts++;
    log(current, "host.network.egress.blocked", "error", { target });
  } else if (pendingHostEgress.length < 100) pendingHostEgress.push(target);
}

export function configureBrowserCompanion(
  window: () => BrowserWindow | null,
  prepare: () => Promise<void>,
  release: () => Promise<void>,
): void {
  getHostWindow = window;
  prepareHost = prepare;
  releaseHost = release;
}

function log(session: Session, event: string, level: BrowserCompanionLog["level"] = "info", data?: Record<string, unknown>): void {
  const safe = data
    ? JSON.parse(redactCompanionLog(JSON.stringify(data), [session.root, session.capability])) as Record<string, unknown>
    : undefined;
  session.logs.push({ seq: ++session.logSequence, ts: Date.now(), level, event, ...(safe ? { data: safe } : {}) });
  if (session.logs.length > MAX_LOGS) session.logs.shift();
}

function status(session: Session | null): BrowserCompanionStatus {
  if (!session) return { active: false, hostLocalOnly: hostPrepared };
  const connected = session.renderer?.readyState === WebSocket.OPEN;
  const canonicalReady =
    session.hostApplied.sessionId === session.canonicalCompiled.sessionId &&
    session.hostApplied.revision === session.canonicalCompiled.revision &&
    session.hostApplied.bundleHash === session.canonicalCompiled.bundleHash;
  const browserReady =
    !!session.browserApplied &&
    session.browserApplied.sessionId === session.canonicalCompiled.sessionId &&
    session.browserApplied.revision === session.canonicalCompiled.revision &&
    session.browserApplied.bundleHash === session.canonicalCompiled.bundleHash;
  const lifecycle = session.mountError
    ? "failed" as const
    : !connected
      ? session.rendererEverConnected || session.capabilityConsumed
        ? "disconnected-fresh-session-required" as const
        : "awaiting-renderer" as const
      : !canonicalReady
        ? "awaiting-host-apply" as const
        : !browserReady
          ? "awaiting-browser-apply" as const
          : "ready" as const;
  return {
    active: true,
    sessionId: session.id,
    origin: session.origin,
    appVersion: app.getVersion(),
    buildHash: session.buildHash,
    protocol: COMPANION_PROTOCOL_VERSION,
    project: {
      id: session.project.id,
      name: session.project.name,
      displayName: session.project.displayName,
    },
    rendererConnected: connected,
    hostWindowVisible: getHostWindow()?.isVisible() ?? false,
    hostWindowMode: session.hostWindowMode,
    hostLocalOnly: true,
    revision: session.revision,
    bundleHash: session.canonicalCompiled.bundleHash,
    canonicalCompiled: session.canonicalCompiled,
    hostApplied: session.hostApplied,
    ...(session.browserApplied ? { browserApplied: session.browserApplied } : {}),
    lifecycle,
    ...(session.mountError ? { mountError: session.mountError } : {}),
    egressAttempts: session.egressAttempts,
  };
}

function reply(data: BrowserCompanionStart | BrowserCompanionStatus | BrowserCompanionLog[]): BrowserCompanionReply {
  return { ok: true, data };
}

export async function handleBrowserCompanionCommand(command: BrowserCompanionCommand): Promise<BrowserCompanionReply> {
  try {
    if (command.action === "prepare") {
      await stopBrowserCompanion();
      try {
        await prepareHost();
        hostPrepared = true;
      } catch (error) {
        await releaseHost();
        throw error;
      }
      preparedSession = { root: command.projectDir, sessionId: randomUUID() };
      canonicalCapture.arm(
        command.projectDir,
        30_000,
        "The hidden Electron renderer did not publish a canonical project bundle in time",
      );
      hostApplicationCapture.arm(
        command.projectDir,
        30_000,
        "The hidden Electron renderer did not acknowledge the canonical project mount in time",
      );
      return reply(status(current));
    }
    if (command.action === "status") return reply(status(current));
    if (command.action === "logs") return reply(current?.logs ?? []);
    if (command.action === "stop") {
      await stopBrowserCompanion();
      return reply(status(current));
    }
    try {
      return reply(await startBrowserCompanion(command.projectDir, command.projectId));
    } catch (error) {
      await stopBrowserCompanion();
      throw error;
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function startBrowserCompanion(root: string, expectedProjectId?: string): Promise<BrowserCompanionStart> {
  await stopBrowserCompanion(true);

  const hostWindow = getHostWindow();
  if (!hostWindow || hostWindow.isDestroyed()) {
    canonicalCapture.cancel();
    throw new Error("The Electron renderer host is not available");
  }

  // The hidden renderer opens and compiles first through the unchanged
  // PROJECTS_COMPILE path. Main records that exact result and only relays it;
  // the companion never owns a second compiler or project-write loop.
  let canonical: CanonicalBundle;
  let hostApplication: HostApplication;
  try {
    [canonical, hostApplication] = await Promise.all([
      canonicalCapture.take(root),
      hostApplicationCapture.take(root),
    ]);
  } catch (error) {
    canonicalCapture.cancel();
    hostApplicationCapture.cancel();
    throw error;
  }
  const bundle = canonical.bundle;
  if (!bundle.ok) throw new Error("The hidden Electron renderer could not compile the selected project");
  if (
    !hostApplication.ok ||
    hostApplication.sessionId !== canonical.identity.sessionId ||
    hostApplication.revision !== canonical.identity.revision ||
    hostApplication.bundleHash !== canonical.bundleHash
  ) {
    throw new Error("The hidden Electron renderer did not mount the exact canonical project bundle");
  }
  const project = await getProject(root);
  if (!project?.id) throw new Error("The Electron host could not establish a project identity");
  if (expectedProjectId && project.id !== expectedProjectId) throw new Error("The requested project does not match the Electron-owned project identity");

  const webRoot = join(app.getAppPath(), "web");
  const buildHash = await hashWebBuild(webRoot);
  const capability = randomBytes(32).toString("base64url");
  const id = canonical.identity.sessionId;

  let expectedOrigin = "";
  const http = createServer((request, response) => serveWeb(webRoot, () => expectedOrigin, request, response));
  const websocket = new WebSocketServer({ noServer: true, maxPayload: MAX_RENDERER_MESSAGE });
  const provisional: Session = {
    id, root, project, capability, buildHash, origin: "", revision: 1,
    canonicalCompiled: canonical.identity,
    hostApplied: canonical.identity,
    browserApplied: null, pendingUpdate: null, mountError: null,
    snapshot: null as unknown as CompanionSnapshot,
    http, websocket, renderer: null, rendererEverConnected: false, capabilityConsumed: false, watcher: null,
    stopped: false, canonicalGeneration: canonical.generation, updateChain: Promise.resolve(),
    egressAttempts: pendingHostEgress.length, logs: [], logSequence: 0,
    dockWasVisible: app.dock?.isVisible() ?? false,
    hostWindowMode: "hidden",
  };

  provisional.snapshot = await makeSnapshot(provisional, bundle, canonical.bundleHash, 1);
  bindWebSocket(provisional);
  http.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", expectedOrigin || "http://127.0.0.1");
    if (
      url.pathname !== "/__companion/session" ||
      request.headers.host !== new URL(expectedOrigin).host ||
      !exactCompanionOrigin(request.headers.origin, expectedOrigin)
    ) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    websocket.handleUpgrade(request, socket, head, (client) => websocket.emit("connection", client));
  });

  await new Promise<void>((resolveListen, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("Companion did not receive a TCP port");
  expectedOrigin = `http://127.0.0.1:${address.port}`;
  provisional.origin = expectedOrigin;
  provisional.snapshot = await makeSnapshot(provisional, bundle, canonical.bundleHash, 1);
  try {
    provisional.watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const path = filename.replace(/\\/g, "/");
      if (path === "node_modules" || path.startsWith("node_modules/") || path === ".diffusion" || path.startsWith(".diffusion/")) return;
      log(provisional, "source.changed", "info", { kind: extname(path).slice(1) || "unknown" });
    });
  } catch (error) {
    await new Promise<void>((resolveClose) => http.close(() => resolveClose()));
    websocket.close();
    throw error;
  }
  provisional.watcher?.on("error", () => log(provisional, "source.watch.failed", "error"));
  current = provisional;
  preparedSession = null;
  log(provisional, "canonicalCompiled", "info", { ...canonical.identity, durationMs: canonical.durationMs });
  log(provisional, "hostApplied", "info", canonical.identity);
  log(provisional, "companion.started", "info", { projectId: project.id, buildHash, protocol: COMPANION_PROTOCOL_VERSION });
  for (const target of pendingHostEgress) log(provisional, "host.network.egress.blocked", "error", { target });
  pendingHostEgress = [];

  hostWindow.hide();
  if (hostWindow.isVisible()) {
    hostWindow.minimize();
    provisional.hostWindowMode = "minimized-fallback";
  }
  app.dock?.hide();
  log(provisional, provisional.hostWindowMode === "hidden" ? "host.hidden" : "host.minimized-fallback", "info", {
    visible: hostWindow.isVisible(),
  });

  const url = `${expectedOrigin}/projects/${encodeURIComponent(project.id)}?companion-shell=1#companion=${capability}&build=${buildHash}`;
  return {
    ...status(provisional),
    active: true,
    url,
    capabilities: { ...CAPABILITIES, trustedProjectCode: true },
    humanStep:
      "Open url in the Codex built-in browser. Phase A supports code-native projects only; local media is fail-closed and unavailable.",
  };
}

async function hashWebBuild(root: string): Promise<string> {
  const hash = createHash("sha256");
  const visit = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        hash.update(path.slice(root.length).replace(/\\/g, "/"));
        hash.update(await readFile(path));
      }
    }
  };
  await visit(root);
  return hash.digest("hex").slice(0, 24);
}

async function makeSnapshot(
  session: Session,
  bundle: CompileResult,
  compiledBundleHash: string,
  revision: number,
): Promise<CompanionSnapshot> {
  const safeBundle = bundle.ok
    ? bundle
    : { ok: false as const, error: redactCompanionLog(bundle.error, [session.root, session.capability]) };
  return {
    protocol: COMPANION_PROTOCOL_VERSION,
    schemaHash: COMPANION_SCHEMA_HASH,
    appVersion: app.getVersion(),
    buildHash: session.buildHash,
    sessionId: session.id,
    revision,
    bundleHash: compiledBundleHash,
    project: { id: session.project.id, name: session.project.name, displayName: session.project.displayName },
    bundle: safeBundle,
    capabilities: CAPABILITIES,
  };
}

function bindWebSocket(session: Session): void {
  session.websocket.on("connection", (client) => {
    let authenticated = false;
    const timer = setTimeout(() => client.close(1008, "Authentication timeout"), 10_000);
    client.on("message", (raw) => {
      let message: Record<string, unknown>;
      try { message = JSON.parse(raw.toString()) as Record<string, unknown>; }
      catch { client.close(1007, "Malformed message"); return; }

      if (!authenticated) {
        const valid = isCompanionAuthentication(message, {
          capability: session.capability,
          buildHash: session.buildHash,
          protocol: COMPANION_PROTOCOL_VERSION,
          schemaHash: COMPANION_SCHEMA_HASH,
          appVersion: app.getVersion(),
          capabilityConsumed: session.capabilityConsumed,
          rendererConnected: session.renderer?.readyState === WebSocket.OPEN,
        });
        if (!valid) {
          log(session, "renderer.authentication.refused", "warning");
          client.send(JSON.stringify({ type: "fatal", error: "Companion protocol/build authentication mismatch" }));
          client.close(1008, "Authentication refused");
          return;
        }
        clearTimeout(timer);
        authenticated = true;
        session.capabilityConsumed = true;
        session.renderer = client;
        session.rendererEverConnected = true;
        client.send(JSON.stringify({ type: "authenticated", snapshot: session.snapshot }));
        log(session, "renderer.authenticated");
        return;
      }

      if (client !== session.renderer) { client.close(1008, "Not active renderer"); return; }
      if (message.type === "applied") {
        const acknowledgement = message.acknowledgement as Partial<{
          sessionId: string;
          revision: number;
          bundleHash: string;
          ok: boolean;
          error: string;
        }> | undefined;
        const exact =
          acknowledgement?.sessionId === session.id &&
          Number.isInteger(acknowledgement.revision) &&
          acknowledgement?.revision === session.hostApplied.revision &&
          acknowledgement?.bundleHash === session.hostApplied.bundleHash &&
          typeof acknowledgement?.ok === "boolean";
        if (!exact) {
          log(session, "browserApplyRefused", "warning");
          return;
        }
        if (!acknowledgement.ok) {
          session.mountError = redactCompanionLog(
            typeof acknowledgement.error === "string" ? acknowledgement.error : "Browser mount failed",
            [session.root, session.capability],
          );
          log(session, "browserApplyFailed", "error", {
            revision: acknowledgement.revision,
            bundleHash: acknowledgement.bundleHash,
            message: session.mountError,
          });
          client.send(JSON.stringify({ type: "fatal", error: "Browser failed to mount the canonical bundle" }));
          client.close(1011, "Browser mount failed");
          return;
        }
        const alreadyApplied = session.browserApplied;
        if (
          alreadyApplied?.sessionId === acknowledgement.sessionId &&
          alreadyApplied?.revision === acknowledgement.revision &&
          alreadyApplied?.bundleHash === acknowledgement.bundleHash
        ) return;
        session.browserApplied = {
          sessionId: acknowledgement.sessionId!,
          revision: acknowledgement.revision!,
          bundleHash: acknowledgement.bundleHash!,
        };
        session.mountError = null;
        log(session, "browserApplied", "info", session.browserApplied);
      } else if (message.type === "semantic" && isCompanionSemantic(message.event)) {
        const data = message.data as { time?: unknown } | undefined;
        const time = data?.time;
        if (typeof time !== "number" || !Number.isFinite(time) || time < 0) {
          log(session, "renderer.semantic.refused", "warning");
          return;
        }
        log(session, message.event, "info", { time: Math.round(time * 1000) / 1000 });
      } else if (message.type === "renderer-log") {
        const level = ["debug", "info", "warning", "error"].includes(String(message.level))
          ? message.level as BrowserCompanionLog["level"] : "info";
        log(session, "renderer.log", level, {
          source: String(message.source ?? "renderer").slice(0, 80),
          message: redactCompanionLog(String(message.message ?? "").slice(0, 4000), [session.root, session.capability]),
        });
      } else if (message.type === "outbound-attempt") {
        session.egressAttempts++;
        log(session, "network.egress.blocked", "error", {
          kind: String(message.kind ?? "unknown").slice(0, 80),
          target: String(message.target ?? "unknown").slice(0, 256),
        });
      } else {
        log(session, "renderer.message.refused", "warning", { type: String(message.type) });
      }
    });
    client.on("close", () => {
      clearTimeout(timer);
      if (session.renderer === client) session.renderer = null;
      log(session, "renderer.disconnected");
    });
  });
}

function headers(response: ServerResponse, origin: string): void {
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader(
    "Content-Security-Policy",
    // Reconciler/TypeGPU and the explicitly trusted compiled project use
    // new Function. This renderer is capability-limited, but project code is
    // not a sandbox; unsafe-eval is therefore an explicit trust declaration.
    "default-src 'self' blob: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' blob: data:; media-src 'self' blob: data:; font-src 'self' blob: data:; " +
      `connect-src 'self' ${origin.replace(/^http:/, "ws:")}; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`,
  );
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".woff": "font/woff", ".woff2": "font/woff2", ".wasm": "application/wasm", ".map": "application/json",
};

function serveWeb(webRoot: string, origin: () => string, request: IncomingMessage, response: ServerResponse): void {
  const expected = origin();
  headers(response, expected);
  if (!expected || request.headers.host !== new URL(expected).host || (request.headers.origin !== undefined && request.headers.origin !== expected)) {
    response.writeHead(421).end("Misdirected request");
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    response.writeHead(405).end();
    return;
  }
  const url = new URL(request.url ?? "/", expected);
  if (url.pathname === "/__companion/health") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ok: true, active: true }));
    return;
  }
  let decoded: string;
  try { decoded = decodeURIComponent(url.pathname); } catch { response.writeHead(400).end(); return; }
  const requested = normalize(decoded).replace(/^[/\\]+/, "");
  void (async () => {
    const candidates = [requested || "index.html"];
    // The packaged desktop build uses base=./. At /projects/:id its relative
    // assets resolve below /projects/, so map that route-relative prefix back
    // to the exact same build root instead of producing a second web build.
    if (requested.startsWith("projects/")) candidates.push(requested.slice("projects/".length));
    for (const candidate of candidates) {
      if (await sendStatic(webRoot, candidate, request, response)) return;
    }
    if (extname(requested)) { response.writeHead(404).end(); return; }
    if (!(await sendStatic(webRoot, "index.html", request, response))) response.writeHead(404).end();
  })().catch(() => {
    if (!response.headersSent) response.writeHead(500).end();
    else response.destroy();
  });
}

async function sendStatic(root: string, requested: string, request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  const path = resolve(root, requested);
  if (!containedWebPath(root, path)) return false;
  let info;
  try { info = await stat(path); } catch { return false; }
  if (!info.isFile()) return false;
  response.setHeader("Content-Type", MIME[extname(path).toLowerCase()] ?? "application/octet-stream");
  response.setHeader("Content-Length", info.size);
  if (request.method === "HEAD") response.end();
  else createReadStream(path).pipe(response);
  return true;
}

export async function stopBrowserCompanion(preservePreparedCapture = false): Promise<void> {
  if (!preservePreparedCapture) {
    canonicalCapture.cancel();
    hostApplicationCapture.cancel();
    preparedSession = null;
  }
  const session = current;
  if (!session) {
    if (!preservePreparedCapture && hostPrepared) {
      hostPrepared = false;
      await releaseHost();
    }
    return;
  }
  current = null;
  session.stopped = true;
  session.watcher?.close();
  if (session.renderer?.readyState === WebSocket.OPEN) {
    session.renderer.send(JSON.stringify({ type: "stopped", sessionId: session.id }));
    session.renderer.close(1001, "Companion stopped");
  }
  for (const client of session.websocket.clients) client.terminate();
  await new Promise<void>((resolveClose) => session.http.close(() => resolveClose()));
  session.websocket.close();
  if (session.dockWasVisible) await app.dock?.show();
  if (!preservePreparedCapture && hostPrepared) {
    hostPrepared = false;
    await releaseHost();
  }
}
