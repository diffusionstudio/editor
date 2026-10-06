/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The chat state the UI renders, at module level so it outlives any page:
// a Solid store fed by the host's snapshots and events through the shared
// reducer. Deltas are batched per animation frame. Everything the host
// owns (chats, transcripts, questions) is a view here; what is ours alone
// is the draft per chat, which tab is up, and which chat each project shows.

import { batch, createRoot } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { toast } from "somoto";

import {
  AgentChatError,
  emptyTranscript,
  reduce,
  type ChatEvent,
  type ChatSnapshot,
  type ChatSummary,
  type HarnessInfo,
  type Item,
  type ModelRef,
  type RequestResponse,
  type ConnectionState,
} from "@diffusionstudio/agent-chat";
import type { Transcript } from "@diffusionstudio/agent-chat";

import { store as settings } from "@/init";
import { track } from "@/lib/analytics";
import { createStoredSignal } from "@/lib/store";
import { projectRoute } from "@/hooks/use-project-route";
import type { ProjectInfo } from "@/projects";

import { attachmentFromPath, attachmentPaths, type Attachment } from "./attachments";
import { client, hasHost } from "./connection";

export type SidebarTab = "assets" | "chat";

export type Draft = { text: string; attachments: Attachment[] };

/** The draft key for a chat that does not exist yet. */
export const draftKey = (projectId: string, chatId: string | null): string => chatId ?? `new:${projectId}`;

type State = {
  connection: ConnectionState;
  harnesses: HarnessInfo[];
  /** Transcripts by chat id, for every chat opened this session. */
  chats: Record<string, Transcript>;
  /** History by project id, newest first. */
  lists: Record<string, ChatSummary[]>;
  drafts: Record<string, Draft>;
  /** The user item shown while `turn.send` is in flight, by draft key. */
  sending: Record<string, Item | null>;
};

const EMPTY_DRAFT: Draft = { text: "", attachments: [] };
const PROBE_MAX_AGE_MS = 60_000;
const CONNECT_TIMEOUT_MS = 4000;

const [state, setState] = createStore<State>({
  connection: "closed",
  harnesses: [],
  chats: {},
  lists: {},
  drafts: {},
  sending: {},
});

export { state as chatState };

// --- settings that persist ---------------------------------------------

const root = createRoot(() => {
  const [tab, setTab] = createStoredSignal(settings.define<SidebarTab>("leftSidebar.tab", "assets"));
  const [model, setModel] = createStoredSignal(settings.define<ModelRef | null>("agentChat.model", null));
  const [active, setActive] = createStoredSignal(settings.define<Record<string, string>>("agentChat.active", {}));
  return { tab, setTab, model, setModel, active, setActive };
});

/** Which tab the left sidebar shows; persists across sessions. */
export const sidebarTab = root.tab;
export const setSidebarTab = root.setTab;

/** The remembered model, whether or not its harness is currently ready. */
export const storedModel = root.model;
export const setStoredModel = root.setModel;

/** Sentinel for "the empty draft chat" in the per-project active map. */
const DRAFT = "";

/** The chat a project's panel shows: the remembered one, else the newest, else a draft (null). */
export function activeChatId(projectId: string): string | null {
  const remembered = root.active()[projectId];
  if (remembered === DRAFT) return null;
  if (remembered && (state.chats[remembered] || state.lists[projectId]?.some((chat) => chat.id === remembered))) return remembered;
  return state.lists[projectId]?.[0]?.id ?? null;
}

export function setActiveChat(projectId: string, chatId: string | null): void {
  root.setActive({ ...root.active(), [projectId]: chatId ?? DRAFT });
}

// --- connection ---------------------------------------------------------

let connected = false;
let harnessesAt = 0;

/** Connects once; safe to call from anywhere the chat is about to be used. */
export function ensureConnected(): void {
  if (connected) return;
  connected = true;
  client.onState((connection) => setState("connection", connection));
  client.onHarnesses((harnesses) => {
    harnessesAt = Date.now();
    setState("harnesses", harnesses);
  });
  setState("connection", hasHost() ? "connecting" : "unavailable");
  if (hasHost()) client.connect();
}

/** Resolves once the socket is open, or rejects after a short wait. */
function whenOpen(): Promise<void> {
  ensureConnected();
  if (client.state === "open") return Promise.resolve();
  if (!hasHost()) return Promise.reject(new AgentChatError("disconnected", "Chat runs in the desktop app"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new AgentChatError("disconnected", "The agent host is not running"));
    }, CONNECT_TIMEOUT_MS);
    const stop = client.onState((connection) => {
      if (connection !== "open") return;
      clearTimeout(timer);
      stop();
      resolve();
    });
  });
}

/** Re-runs the probes when the cached ones are older than a minute. */
export function refreshHarnesses(): void {
  if (client.state !== "open" || Date.now() - harnessesAt < PROBE_MAX_AGE_MS) return;
  harnessesAt = Date.now();
  void client.request("harnesses.list", { refresh: true }).catch(() => {});
}

export const readyHarnesses = (): HarnessInfo[] => state.harnesses.filter((harness) => harness.status === "ready");

/** Families picked before anything is remembered, best first, across every ready harness. */
const PREFERRED_MODELS = [/astra/i, /sol/i, /fable/i, /opus/i];

/**
 * The model the composers send with: the remembered one if its harness is
 * ready, else the best preferred family on offer, else the first ready default.
 */
export function currentModel(): ModelRef | null {
  const ready = readyHarnesses();
  const remembered = root.model();
  if (remembered) {
    const harness = ready.find((entry) => entry.id === remembered.harness);
    if (harness && harness.models.some((model) => model.id === remembered.model)) return remembered;
  }
  for (const pattern of PREFERRED_MODELS) {
    for (const harness of ready) {
      const match = harness.models.find((model) => pattern.test(model.id) || pattern.test(model.label));
      if (match) return { harness: harness.id, model: match.id };
    }
  }
  const first = ready[0];
  if (!first) return null;
  const model = first.defaultModel ?? first.models[0]?.id;
  return model ? { harness: first.id, model } : null;
}

/** The label the pickers show for a model ref. */
export function modelLabel(ref: ModelRef | null): string {
  if (!ref) return "No agent available";
  const harness = state.harnesses.find((entry) => entry.id === ref.harness);
  return harness?.models.find((model) => model.id === ref.model)?.label ?? ref.model;
}

// --- events -------------------------------------------------------------

const queue = new Map<string, ChatEvent[]>();
let flushScheduled = false;
/** New chats whose optimistic item waits for the first snapshot, by chat id → draft key. */
const awaitingSnapshot = new Map<string, string>();

function flush(): void {
  flushScheduled = false;
  if (queue.size === 0) return;
  const pending = [...queue];
  queue.clear();
  batch(() => {
    for (const [chatId, events] of pending) {
      let transcript = state.chats[chatId] ?? emptyTranscript();
      for (const event of events) {
        transcript = reduce(transcript, event);
        if (event.type === "chat.updated") upsertSummary(event.chat);
        if (event.type === "turn.started") setState("sending", chatId, null);
      }
      setState("chats", chatId, transcript);
    }
  });
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  requestAnimationFrame(flush);
  // A hidden tab gets no frames; the timer keeps history and status honest.
  setTimeout(flush, 120);
}

function upsertSummary(chat: ChatSummary): void {
  setState(
    "lists",
    chat.projectId,
    produce((list) => {
      if (!list) return;
      const index = list.findIndex((entry) => entry.id === chat.id);
      if (index >= 0) list[index] = chat;
      else list.unshift(chat);
      list.sort((a, b) => b.updatedAt - a.updatedAt);
    }),
  );
  if (!state.lists[chat.projectId]) setState("lists", chat.projectId, [chat]);
}

const subscriptions = new Map<string, () => void>();

/** Subscribes to a chat (once); the transcript lands in the store and stays current. */
export function openChat(chatId: string): void {
  ensureConnected();
  if (subscriptions.has(chatId)) return;
  const unsubscribe = client.open(chatId, (message) => {
    if (message.type === "snapshot") {
      applySnapshot(message.snapshot);
      const key = awaitingSnapshot.get(chatId);
      if (key) {
        awaitingSnapshot.delete(chatId);
        setState("sending", key, null);
      }
      return;
    }
    const events = queue.get(chatId);
    if (events) events.push(message.event);
    else queue.set(chatId, [message.event]);
    scheduleFlush();
  });
  subscriptions.set(chatId, unsubscribe);
}

function applySnapshot(snapshot: ChatSnapshot): void {
  queue.delete(snapshot.chat.id);
  batch(() => {
    setState("chats", snapshot.chat.id, { items: snapshot.items, pending: snapshot.pending, turnId: null, chat: snapshot.chat });
    upsertSummary(snapshot.chat);
  });
}

/** Fetches a project's history; the store keeps it current from then on. */
export async function refreshChats(projectId: string): Promise<void> {
  try {
    await whenOpen();
    const list = await client.request("chats.list", { projectId });
    setState("lists", projectId, list);
  } catch {
    // Offline: whatever the store holds stays.
  }
}

// --- drafts -------------------------------------------------------------

export const draft = (key: string): Draft => state.drafts[key] ?? EMPTY_DRAFT;

export function setDraftText(key: string, text: string): void {
  setState("drafts", key, { ...draft(key), text });
}

export function setDraftAttachments(key: string, attachments: Attachment[]): void {
  setState("drafts", key, { ...draft(key), attachments });
}

export function clearDraft(key: string): void {
  setState("drafts", key, EMPTY_DRAFT);
}

// --- actions ------------------------------------------------------------

export type SendOptions = {
  projectId: string;
  cwd: string;
  chatId: string | null;
  text: string;
  attachments: string[];
  model: ModelRef;
};

/** Sends a turn; resolves with the chat id as soon as the host accepted it. */
export async function send(options: SendOptions): Promise<string> {
  const key = draftKey(options.projectId, options.chatId);
  track("prompt_sent", {
    new_chat: !options.chatId,
    harness: options.model.harness,
    model: options.model.model,
    length: options.text.length,
    attachments: options.attachments.length,
  });
  const optimistic: Item = {
    id: `optimistic-${Date.now()}`,
    kind: "user",
    text: options.text,
    ...(options.attachments.length ? { attachments: options.attachments } : {}),
  };
  setState("sending", key, optimistic);
  try {
    await whenOpen();
    const { chatId } = await client.request("turn.send", {
      ...(options.chatId ? { chatId: options.chatId } : {}),
      projectId: options.projectId,
      cwd: options.cwd,
      text: options.text,
      ...(options.attachments.length ? { attachments: options.attachments } : {}),
      model: options.model,
    });
    if (!options.chatId) {
      awaitingSnapshot.set(chatId, key);
      setActiveChat(options.projectId, chatId);
    }
    openChat(chatId);
    flush();
    if (options.chatId) setState("sending", key, null);
    return chatId;
  } catch (error) {
    setState("sending", key, null);
    throw error;
  }
}

export async function interrupt(chatId: string): Promise<void> {
  await client.request("turn.interrupt", { chatId });
}

export async function respond(chatId: string, requestId: string, response: RequestResponse): Promise<void> {
  await client.request("request.respond", { chatId, requestId, response });
}

export async function deleteChat(projectId: string, chatId: string): Promise<void> {
  subscriptions.get(chatId)?.();
  subscriptions.delete(chatId);
  await client.request("chats.delete", { chatId });
  batch(() => {
    setState("lists", projectId, (list) => (list ?? []).filter((entry) => entry.id !== chatId));
    setState("chats", chatId, undefined!);
    setState("drafts", chatId, undefined!);
  });
  if (root.active()[projectId] === chatId) setActiveChat(projectId, activeChatId(projectId));
}

/** The transcript to render for a chat; empty until its snapshot lands. */
export const transcriptOf = (chatId: string | null): Transcript => (chatId ? (state.chats[chatId] ?? emptyTranscript()) : emptyTranscript());

/** The summary as the host last reported it; the list's copy until the transcript's arrives. */
export function summaryOf(projectId: string, chatId: string | null): ChatSummary | null {
  if (!chatId) return null;
  return state.chats[chatId]?.chat ?? state.lists[projectId]?.find((entry) => entry.id === chatId) ?? null;
}

// --- home-view handoff ---------------------------------------------------

export type StartChatOptions = {
  project: ProjectInfo;
  text: string;
  attachments: string[];
  model: ModelRef;
};

/**
 * Starts a chat from the dashboard: sends the first turn, makes the new chat
 * the project's active one and opens the Chat tab, so the editor lands with
 * the reply already streaming. On failure the text survives as the project's
 * draft and the error is a toast; home navigates either way.
 */
export async function startChat(options: StartChatOptions): Promise<void> {
  const projectId = options.project.id;
  setSidebarTab("chat");
  // The layout provider is not mounted on the dashboard, so its stored key
  // is written directly: the editor reads it when it mounts.
  settings.define<boolean>("layout.uiVisible", true).value = true;
  try {
    await send({ 
      projectId, 
      cwd: options.project.dir, 
      chatId: null, 
      text: options.text, 
      attachments: options.attachments, 
      model: options.model,
    });
  } catch (error) {
    setActiveChat(projectId, null);
    setState("drafts", draftKey(projectId, null), {
      text: options.text,
      attachments: options.attachments.map(attachmentFromPath),
    });
    toast.error("Could not start the chat", { description: (error as Error).message });
  }
}

/** The route a started chat lands on. */
export const chatRoute = (project: ProjectInfo): string => projectRoute(project.id || project.name);

export { attachmentPaths };

/** Left sidebar width by tab: room for about 50 characters of 12 px text on the Chat tab. */
export const ASSETS_SIDEBAR_WIDTH = 264;
export const CHAT_SIDEBAR_WIDTH = 340;

export const leftSidebarWidth = (): number => (sidebarTab() === "chat" ? CHAT_SIDEBAR_WIDTH : ASSETS_SIDEBAR_WIDTH);

/** For the empty state: why nothing can be sent right now, or null. */
export function blockedReason(): string | null {
  if (state.connection === "unavailable") return "Chat runs in the desktop app.";
  if (state.connection !== "open") return "Connecting to the agent host…";
  if (state.harnesses.length && state.harnesses.every((harness) => harness.status === "checking")) return "Looking for Claude Code and Codex…";
  if (!readyHarnesses().length) {
    const detail = state.harnesses.map((harness) => harness.detail).find(Boolean);
    return detail ? `No agent is ready. ${detail}.` : "Install Claude Code or Codex to chat.";
  }
  return null;
}
