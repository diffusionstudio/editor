/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The host owns every chat: its summary and transcript, the harness
// session behind it (at most one, closed after ten idle minutes), the
// turn that is running and the question it may be waiting on. Clients
// are views: they open a chat for a snapshot and then get its events,
// and they can come and go at any time without disturbing a turn.

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { isPersistedEvent, reduce } from "../reduce";
import { HARNESS_IDS, HARNESS_LABELS, isHarnessId, titleFor } from "../protocol";
import { withAttachments, chatInstructions } from "./harness";

import type {
  ChatEvent,
  ChatSnapshot,
  ChatSummary,
  ClientMsg,
  ErrorCode,
  HarnessId,
  HarnessInfo,
  HostMsg,
  Item,
  Method,
  MethodParams,
  MethodResult,
  ModelRef,
  RequestResponse,
  TurnStatus,
} from "../protocol";
import type { Transcript } from "../reduce";
import type { HostEnv } from "./env";
import type { Emit, Harness, HarnessSession, McpConfig, TurnOutcome } from "./harness";
import type { ChatMeta, ChatStore } from "./store";

export class HostError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "HostError";
    this.code = code;
  }
}

export type Connection = { send(message: HostMsg): void };

export type AgentHostOptions = {
  store: ChatStore;
  harnesses: Harness[];
  /** Resolves once the environment is hydrated; probes wait for it. */
  env: Promise<HostEnv>;
  mcp: McpConfig | null;
  instructions?: string;
  version: string;
  /** How long a session outlives its last turn. */
  idleMs?: number;
  /** How old a probe may be before `refresh` re-runs it. */
  probeMaxAgeMs?: number;
  /** Where uploaded attachments are written; default a folder in the system temp dir. */
  uploadDir?: string;
  log?: (message: string) => void;
};

type Chat = {
  meta: ChatMeta;
  transcript: Transcript;
  /** Whether `transcript` has been folded from disk yet. */
  loaded: boolean;
  seq: number;
  session: HarnessSession | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  turn: { id: string; done: Promise<void>; interrupted: boolean } | null;
  /** Items started in this turn and not yet completed, with their latest text. */
  open: Map<string, Item>;
  subscribers: Set<Connection>;
  /** Whether the "editor tools unavailable" notice has been posted. */
  noticedNoMcp: boolean;
};

const IDLE_MS = 10 * 60 * 1000;
const PROBE_MAX_AGE_MS = 60 * 1000;

export class AgentHost {
  private readonly options: AgentHostOptions;
  private readonly chats = new Map<string, Chat>();
  private readonly connections = new Set<Connection>();
  private readonly harnessById = new Map<HarnessId, Harness>();
  private readonly probes = new Map<HarnessId, { info: HarnessInfo; at: number }>();
  private probing: Promise<HarnessInfo[]> | null = null;
  private probeAbort: AbortController | null = null;
  private stopping = false;

  constructor(options: AgentHostOptions) {
    this.options = options;
    for (const harness of options.harnesses) this.harnessById.set(harness.id, harness);
  }

  private log(message: string): void {
    this.options.log?.(message);
  }

  // ---------------------------------------------------------------------
  // Lifecycle

  /** Loads the chat metas and settles anything a crash left running. */
  async start(): Promise<void> {
    for (const meta of await this.options.store.list()) {
      const chat = this.register(meta);
      if (meta.status !== "idle") {
        // The harness process is gone with the last host; the turn is over.
        await this.options.store.append(meta.id, { type: "turn.completed", turnId: "recovered", status: "interrupted" });
        chat.meta = { ...meta, status: "idle" };
        await this.options.store.writeMeta(chat.meta);
      }
    }
    void this.probeAll();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.probeAbort?.abort();
    const chats = [...this.chats.values()];
    await Promise.all(
      chats.map(async (chat) => {
        if (chat.idleTimer) clearTimeout(chat.idleTimer);
        if (chat.turn) {
          chat.turn.interrupted = true;
          chat.session?.respond(chat.transcript.pending?.id ?? "", "cancel");
          await chat.session?.interrupt().catch(() => {});
          await chat.turn.done.catch(() => {});
        }
        await chat.session?.close().catch(() => {});
        chat.session = null;
      }),
    );
  }

  // ---------------------------------------------------------------------
  // Connections

  connect(connection: Connection): { receive(raw: string): void; disconnect(): void } {
    this.connections.add(connection);
    connection.send({ t: "harnesses", harnesses: this.harnessList() });
    return {
      receive: (raw) => void this.receive(connection, raw),
      disconnect: () => {
        this.connections.delete(connection);
        for (const chat of this.chats.values()) chat.subscribers.delete(connection);
      },
    };
  }

  private async receive(connection: Connection, raw: string): Promise<void> {
    let message: ClientMsg;
    try {
      message = JSON.parse(raw) as ClientMsg;
    } catch {
      return;
    }
    if (!message || message.t !== "req" || typeof message.id !== "string") return;
    try {
      const data = await this.handle(connection, message.method, message.params);
      connection.send({ t: "res", id: message.id, ok: true, data });
    } catch (error) {
      const failure =
        error instanceof HostError ? error : new HostError("internal", (error as Error)?.message ?? String(error));
      if (!(error instanceof HostError)) this.log(`${message.method} failed: ${failure.message}`);
      connection.send({ t: "res", id: message.id, ok: false, error: { code: failure.code, message: failure.message } });
    }
  }

  /** Dispatches one request. Public so tests can drive the host without a socket. */
  async handle<M extends Method>(connection: Connection, method: M, params: unknown): Promise<MethodResult<M>> {
    type R = MethodResult<M>;
    const p = (params ?? {}) as MethodParams<M>;
    switch (method) {
      case "harnesses.list":
        return this.listHarnesses((p as MethodParams<"harnesses.list">).refresh === true) as Promise<R>;
      case "chats.list":
        return this.listChats(requireString(p, "projectId")) as R;
      case "chats.open":
        return this.openChat(connection, requireString(p, "chatId")) as Promise<R>;
      case "chats.close":
        this.get(requireString(p, "chatId")).subscribers.delete(connection);
        return undefined as R;
      case "chats.delete":
        return this.deleteChat(requireString(p, "chatId")) as Promise<R>;
      case "turn.send":
        return this.send(connection, p as MethodParams<"turn.send">) as Promise<R>;
      case "turn.interrupt":
        return this.interrupt(requireString(p, "chatId")) as Promise<R>;
      case "attachments.upload":
        return this.upload(p as MethodParams<"attachments.upload">) as Promise<R>;
      case "request.respond": {
        const { chatId, requestId, response } = p as MethodParams<"request.respond">;
        return this.respond(requireString({ chatId }, "chatId"), requireString({ requestId }, "requestId"), response) as R;
      }
      default:
        throw new HostError("bad-request", `Unknown method ${String(method)}`);
    }
  }

  // ---------------------------------------------------------------------
  // Attachments

  /**
   * A folder of its own per upload keeps the file's name — `image.png` for a
   * screenshot — without two uploads landing on the same path.
   */
  private async upload(params: MethodParams<"attachments.upload">): Promise<{ path: string }> {
    const name = basename(requireString(params, "name")).replace(/^\.+/, "") || "pasted";
    const data = requireString(params, "data");
    const dir = join(this.options.uploadDir ?? join(tmpdir(), "diffusion-studio-pasted"), randomUUID());
    await mkdir(dir, { recursive: true });
    const path = join(dir, name);
    await writeFile(path, Buffer.from(data, "base64"));
    return { path };
  }

  // ---------------------------------------------------------------------
  // Harnesses

  private harnessList(): HarnessInfo[] {
    return HARNESS_IDS.filter((id) => this.harnessById.has(id)).map(
      (id) => this.probes.get(id)?.info ?? { id, label: HARNESS_LABELS[id], status: "checking", models: [] },
    );
  }

  private async listHarnesses(refresh: boolean): Promise<HarnessInfo[]> {
    const oldest = Math.min(...[...this.probes.values()].map((entry) => entry.at), Infinity);
    const stale = this.probes.size < this.harnessById.size || Date.now() - oldest > (this.options.probeMaxAgeMs ?? PROBE_MAX_AGE_MS);
    if (refresh && stale) return this.probeAll();
    if (this.probing) return this.probing;
    return this.harnessList();
  }

  private probeAll(): Promise<HarnessInfo[]> {
    if (this.probing) return this.probing;
    const abort = new AbortController();
    this.probeAbort = abort;
    this.probing = (async () => {
      const env = await this.options.env;
      await Promise.all(
        [...this.harnessById.values()].map(async (harness) => {
          let info: HarnessInfo;
          try {
            info = await harness.probe(env, abort.signal);
          } catch (error) {
            info = {
              id: harness.id,
              label: HARNESS_LABELS[harness.id],
              status: "error",
              detail: (error as Error)?.message ?? String(error),
              models: [],
            };
          }
          this.probes.set(harness.id, { info, at: Date.now() });
        }),
      );
      const list = this.harnessList();
      this.broadcast({ t: "harnesses", harnesses: list });
      return list;
    })().finally(() => {
      this.probing = null;
      if (this.probeAbort === abort) this.probeAbort = null;
    });
    return this.probing;
  }

  // ---------------------------------------------------------------------
  // Chats

  private register(meta: ChatMeta): Chat {
    const chat: Chat = {
      meta,
      transcript: { items: [], pending: null, turnId: null, chat: null },
      loaded: false,
      seq: 0,
      session: null,
      idleTimer: null,
      turn: null,
      open: new Map(),
      subscribers: new Set(),
      noticedNoMcp: false,
    };
    this.chats.set(meta.id, chat);
    return chat;
  }

  private get(chatId: string): Chat {
    const chat = this.chats.get(chatId);
    if (!chat) throw new HostError("not-found", `No chat ${chatId}`);
    return chat;
  }

  private summary(chat: Chat): ChatSummary {
    const { cwd: _cwd, resume: _resume, ...summary } = chat.meta;
    return summary;
  }

  private listChats(projectId: string): ChatSummary[] {
    return [...this.chats.values()]
      .filter((chat) => chat.meta.projectId === projectId)
      .sort((a, b) => b.meta.updatedAt - a.meta.updatedAt)
      .map((chat) => this.summary(chat));
  }

  private async ensureLoaded(chat: Chat): Promise<void> {
    if (chat.loaded) return;
    const transcript = await this.options.store.readTranscript(chat.meta.id);
    // A turn that started while the file was read has already put items in memory.
    if (chat.loaded) return;
    chat.transcript = { ...transcript, items: [...transcript.items, ...chat.transcript.items], pending: chat.transcript.pending, turnId: chat.transcript.turnId };
    chat.loaded = true;
  }

  private async openChat(connection: Connection, chatId: string): Promise<ChatSnapshot> {
    const chat = this.get(chatId);
    await this.ensureLoaded(chat);
    chat.subscribers.add(connection);
    return { chat: this.summary(chat), items: chat.transcript.items, seq: chat.seq, pending: chat.transcript.pending };
  }

  private async deleteChat(chatId: string): Promise<void> {
    const chat = this.get(chatId);
    if (chat.turn) await this.interrupt(chatId);
    if (chat.idleTimer) clearTimeout(chat.idleTimer);
    await chat.session?.close().catch(() => {});
    chat.session = null;
    this.chats.delete(chatId);
    await this.options.store.remove(chatId);
  }

  /** Deletes every chat of a project, stopping any that is running: its folder is gone. */
  async deleteChats(projectId: string): Promise<void> {
    const ids = [...this.chats.values()].filter((chat) => chat.meta.projectId === projectId).map((chat) => chat.meta.id);
    await Promise.all(
      ids.map((id) => this.deleteChat(id).catch((error: Error) => this.log(`delete ${id} failed: ${error.message}`))),
    );
  }

  // ---------------------------------------------------------------------
  // Turns

  private async send(connection: Connection, params: MethodParams<"turn.send">): Promise<{ chatId: string }> {
    const text = typeof params.text === "string" ? params.text : "";
    const projectId = requireString(params, "projectId");
    const cwd = requireString(params, "cwd");
    const model = validateModel(params.model);
    const attachments = Array.isArray(params.attachments) ? params.attachments.filter((a): a is string => typeof a === "string") : [];
    if (!text.trim() && attachments.length === 0) throw new HostError("bad-request", "Nothing to send");

    let chat: Chat;
    if (params.chatId) {
      chat = this.get(params.chatId);
      if (chat.meta.harness !== model.harness) throw new HostError("harness-mismatch", "A chat keeps the harness it started with");
      if (chat.turn) throw new HostError("busy", "A turn is already running");
      await this.ensureLoaded(chat);
    } else if (!this.harnessById.has(model.harness)) {
      throw new HostError("harness-unavailable", `${HARNESS_LABELS[model.harness]} is not available`);
    } else {
      const now = Date.now();
      chat = this.register({
        id: randomUUID(),
        projectId,
        title: titleFor(text || attachments.map(baseName).join(", ")),
        harness: model.harness,
        model: model.model,
        status: "idle",
        createdAt: now,
        updatedAt: now,
        cwd,
        resume: null,
      });
      chat.loaded = true;
      chat.subscribers.add(connection);
    }

    const probe = this.probes.get(model.harness)?.info ?? (await this.probeAll()).find((info) => info.id === model.harness);
    if (probe && probe.status !== "ready") {
      if (!params.chatId) this.chats.delete(chat.meta.id);
      throw new HostError("harness-unavailable", probe.detail ?? `${probe.label} is ${probe.status.replace("-", " ")}`);
    }

    if (chat.idleTimer) clearTimeout(chat.idleTimer);
    chat.idleTimer = null;

    const turnId = randomUUID();
    const user: Item = { id: `u-${turnId.slice(0, 12)}`, kind: "user", text, ...(attachments.length ? { attachments } : {}) };
    chat.meta = { ...chat.meta, cwd, model: model.model, status: "running", updatedAt: Date.now() };
    await this.options.store.writeMeta(chat.meta);

    const emit = this.emitter(chat, turnId);
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => (resolveDone = resolve));
    chat.turn = { id: turnId, done, interrupted: false };
    emit({ type: "chat.updated", chat: this.summary(chat) });
    emit({ type: "turn.started", turnId, model: model.model, user });

    void this.runTurn(chat, turnId, withAttachments(text, attachments), model.model, emit).finally(resolveDone);
    return { chatId: chat.meta.id };
  }

  private emitter(chat: Chat, turnId: string): Emit {
    return (event) => {
      if (event.type === "turn.completed") event = { ...event, turnId };
      chat.transcript = reduce(chat.transcript, event);
      // Track what is still open, so an ended turn can close it out.
      if (event.type === "item.started") chat.open.set(event.item.id, event.item);
      else if (event.type === "item.completed") chat.open.delete(event.item.id);
      else if (event.type === "item.delta" && chat.open.has(event.itemId)) {
        const current = chat.transcript.items.find((item) => item.id === event.itemId);
        if (current) chat.open.set(event.itemId, current);
      }
      if (event.type === "request.opened" && chat.meta.status === "running") {
        chat.meta = { ...chat.meta, status: "waiting", updatedAt: Date.now() };
        void this.options.store.writeMeta(chat.meta);
        this.publish(chat, { type: "chat.updated", chat: this.summary(chat) });
      } else if (event.type === "request.resolved" && chat.meta.status === "waiting" && chat.turn) {
        chat.meta = { ...chat.meta, status: "running", updatedAt: Date.now() };
        void this.options.store.writeMeta(chat.meta);
        this.publish(chat, { type: "chat.updated", chat: this.summary(chat) });
      }
      this.publish(chat, event);
    };
  }

  private publish(chat: Chat, event: ChatEvent): void {
    chat.seq += 1;
    if (isPersistedEvent(event)) {
      this.options.store.append(chat.meta.id, event).catch((error: Error) => this.log(`append failed: ${error.message}`));
    }
    const message: HostMsg = { t: "event", chatId: chat.meta.id, seq: chat.seq, event };
    for (const subscriber of chat.subscribers) subscriber.send(message);
  }

  private async runTurn(chat: Chat, turnId: string, text: string, model: string, emit: Emit): Promise<void> {
    let outcome: TurnOutcome;
    try {
      if (!this.options.mcp && !chat.noticedNoMcp) {
        chat.noticedNoMcp = true;
        emit({ type: "item.completed", item: { id: `n-${turnId.slice(0, 12)}`, kind: "notice", level: "info", text: "Editor tools unavailable" } });
      }
      const session = await this.ensureSession(chat, model, emit);
      outcome = (await session.send(text, model, emit)) ?? { status: "completed" };
    } catch (error) {
      const message = (error as Error)?.message ?? String(error);
      outcome = chat.turn?.interrupted ? { status: "interrupted" } : { status: "failed", error: message };
      if (!chat.turn?.interrupted) {
        emit({ type: "item.completed", item: { id: `n-${turnId.slice(0, 12)}-err`, kind: "notice", level: "error", text: message } });
      }
    }
    if (chat.turn?.interrupted && outcome.status === "completed") outcome = { status: "interrupted" };
    this.finalizeOpen(chat, outcome.status, emit);
    emit({ type: "turn.completed", turnId, status: outcome.status, ...(outcome.error ? { error: outcome.error } : {}) });
    chat.turn = null;
    chat.meta = { ...chat.meta, status: "idle", resume: chat.session?.resume ?? chat.meta.resume, updatedAt: Date.now() };
    await this.options.store.writeMeta(chat.meta);
    emit({ type: "chat.updated", chat: this.summary(chat) });
    this.scheduleIdle(chat);
  }

  /** Whatever the harness left open is closed out so the log holds what was seen. */
  private finalizeOpen(chat: Chat, status: TurnStatus, emit: Emit): void {
    for (const item of [...chat.open.values()]) {
      const latest = chat.transcript.items.find((entry) => entry.id === item.id) ?? item;
      if (latest.kind === "tool") {
        emit({ type: "item.completed", item: { ...latest, status: status === "completed" ? "done" : "failed" } });
      } else if (latest.kind === "assistant" || latest.kind === "reasoning") {
        if (latest.text) emit({ type: "item.completed", item: latest });
        else chat.open.delete(item.id);
      } else {
        emit({ type: "item.completed", item: latest });
      }
    }
    chat.open.clear();
  }

  private async ensureSession(chat: Chat, model: string, emit: Emit): Promise<HarnessSession> {
    if (chat.session) return chat.session;
    const harness = this.harnessById.get(chat.meta.harness);
    if (!harness) throw new HostError("harness-unavailable", `${HARNESS_LABELS[chat.meta.harness]} is not available`);
    const env = await this.options.env;
    const session = await harness.open({
      cwd: chat.meta.cwd,
      model,
      resume: chat.meta.resume ?? undefined,
      mcp: this.options.mcp,
      instructions: chatInstructions(chat.meta.cwd, this.options.instructions),
      env,
      emit,
    });
    chat.session = session;
    chat.meta = { ...chat.meta, resume: session.resume };
    return session;
  }

  private scheduleIdle(chat: Chat): void {
    if (chat.idleTimer) clearTimeout(chat.idleTimer);
    if (this.stopping) return;
    chat.idleTimer = setTimeout(() => {
      chat.idleTimer = null;
      if (chat.turn) return;
      const session = chat.session;
      chat.session = null;
      void session?.close().catch(() => {});
    }, this.options.idleMs ?? IDLE_MS);
  }

  private async interrupt(chatId: string): Promise<void> {
    const chat = this.get(chatId);
    const turn = chat.turn;
    if (!turn) return;
    turn.interrupted = true;
    const pending = chat.transcript.pending;
    if (pending) chat.session?.respond(pending.id, "cancel");
    await chat.session?.interrupt().catch(() => {});
    await turn.done;
  }

  private respond(chatId: string, requestId: string, response: RequestResponse): void {
    const chat = this.get(chatId);
    const pending = chat.transcript.pending;
    if (!pending || pending.id !== requestId || !chat.session) throw new HostError("no-request", "No question is waiting");
    if (response !== "skip" && response !== "cancel" && (typeof response !== "object" || typeof response.answers !== "object")) {
      throw new HostError("bad-request", "Malformed response");
    }
    chat.session.respond(requestId, response);
  }

  private broadcast(message: HostMsg): void {
    for (const connection of this.connections) connection.send(message);
  }
}

function requireString(record: object, key: string): string {
  const value = (record as Record<string, unknown>)[key];
  if (typeof value !== "string" || !value) throw new HostError("bad-request", `Missing ${key}`);
  return value;
}

function validateModel(value: unknown): ModelRef {
  const model = value as Partial<ModelRef> | undefined;
  if (!model || !isHarnessId(model.harness) || typeof model.model !== "string") {
    throw new HostError("bad-request", "Missing model");
  }
  return { harness: model.harness, model: model.model };
}

function baseName(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || path;
}
