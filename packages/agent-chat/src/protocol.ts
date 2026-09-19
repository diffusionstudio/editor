/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The wire between the chat UI and the agent host: JSON text frames over a
// WebSocket. Browser-safe — nothing here knows about Node, Electron or where
// a project lives. The host owns all state; the UI is a view over a snapshot
// (`chats.open`) plus the events that follow it.

export type HarnessId = "claude" | "codex" | "opencode";

/** The single dropdown's value: which harness, and which of its models. */
export type ModelRef = { harness: HarnessId; model: string };

export type HarnessStatus = "ready" | "not-installed" | "signed-out" | "error" | "checking";

export type HarnessInfo = {
  id: HarnessId;
  /** "Claude Code" | "Codex" | "opencode" */
  label: string;
  status: HarnessStatus;
  /** e.g. "Run `codex login` in a terminal" */
  detail?: string;
  version?: string;
  models: { id: string; label: string }[];
  defaultModel?: string;
};

export type ChatStatus = "idle" | "running" | "waiting";

export type ChatSummary = {
  id: string;
  projectId: string;
  title: string;
  harness: HarnessId;
  model: string;
  /** `waiting` = a question needs the user. */
  status: ChatStatus;
  createdAt: number;
  updatedAt: number;
};

export type ToolStatus = "running" | "done" | "failed";

export type ToolImage = { mediaType: string; data: string };

export type Item =
  | { id: string; kind: "user"; text: string; attachments?: string[] }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "reasoning"; text: string }
  | { id: string; kind: "tool"; name: string; title: string; detail?: string; output?: string; images?: ToolImage[]; status: ToolStatus }
  | { id: string; kind: "question"; questions: Question[]; answers: Record<string, string[]> | null }
  | { id: string; kind: "notice"; level: "info" | "error"; text: string };

export type ItemKind = Item["kind"];

export type TurnStatus = "completed" | "interrupted" | "failed";

export type ChatEvent =
  | { type: "turn.started"; turnId: string; model: string; user: Item }
  | { type: "item.started"; item: Item }
  /** Appends to an open assistant / reasoning item. */
  | { type: "item.delta"; itemId: string; text: string }
  /** The full, final item; replaces whatever was started under that id. */
  | { type: "item.completed"; item: Item }
  | { type: "turn.completed"; turnId: string; status: TurnStatus; error?: string }
  | { type: "request.opened"; request: PendingRequest }
  | { type: "request.resolved"; requestId: string; outcome: "answered" | "skipped" | "cancel" }
  | { type: "chat.updated"; chat: ChatSummary };

/** The only kind of request in v1. Tagged, so approvals can be added later without a protocol change. */
export type PendingRequest = { id: string; type: "question"; questions: Question[] };

export type Question = {
  /** Claude: the full question text (the SDK looks answers up by it); Codex: its id. */
  id: string;
  /** Short chip label, ≤ 12 chars. */
  header: string;
  question: string;
  /** Empty = free text only. */
  options: { label: string; description: string }[];
  multiSelect: boolean;
  /** Claude: always; Codex: isOther. */
  allowOther: boolean;
  /** Codex isSecret → password field. */
  secret: boolean;
};

export type RequestResponse = { answers: Record<string, string[]> } | "skip" | "cancel";

// ---------------------------------------------------------------------------
// Methods

export type ChatSnapshot = {
  chat: ChatSummary;
  items: Item[];
  /** Events with `seq` at or below this are already in `items`. */
  seq: number;
  /** A question the harness is waiting on, so a late client can still answer it. */
  pending: PendingRequest | null;
};

export type MethodMap = {
  "harnesses.list": { params: { refresh?: boolean }; result: HarnessInfo[] };
  "chats.list": { params: { projectId: string }; result: ChatSummary[] };
  "chats.open": { params: { chatId: string }; result: ChatSnapshot };
  "chats.close": { params: { chatId: string }; result: void };
  "chats.delete": { params: { chatId: string }; result: void };
  "turn.send": {
    params: {
      chatId?: string;
      projectId: string;
      cwd: string;
      text: string;
      attachments?: string[];
      model: ModelRef;
    };
    result: { chatId: string };
  };
  "turn.interrupt": { params: { chatId: string }; result: void };
  "request.respond": {
    params: { chatId: string; requestId: string; response: RequestResponse };
    result: void;
  };
};

export type Method = keyof MethodMap;
export type MethodParams<M extends Method> = MethodMap[M]["params"];
export type MethodResult<M extends Method> = MethodMap[M]["result"];

export type ErrorCode =
  | "bad-request"
  | "not-found"
  | "busy"
  | "harness-mismatch"
  | "harness-unavailable"
  | "no-request"
  | "internal";

export type HostError = { code: ErrorCode; message: string };

// ---------------------------------------------------------------------------
// Envelopes

export type ClientMsg = { t: "req"; id: string; method: Method; params: unknown };

export type HostMsg =
  | { t: "res"; id: string; ok: true; data: unknown }
  | { t: "res"; id: string; ok: false; error: HostError }
  | { t: "event"; chatId: string; seq: number; event: ChatEvent }
  /** Pushed whenever the probes change. */
  | { t: "harnesses"; harnesses: HarnessInfo[] };

/** Title = first user message, whitespace-collapsed, truncated to 60 chars. */
export const TITLE_MAX = 60;

export function titleFor(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= TITLE_MAX) return collapsed || "New chat";
  return collapsed.slice(0, TITLE_MAX - 1).trimEnd() + "…";
}

export const HARNESS_LABELS: Record<HarnessId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "opencode",
};

export const HARNESS_IDS: readonly HarnessId[] = ["claude", "codex", "opencode"];

export function isHarnessId(value: unknown): value is HarnessId {
  return value === "claude" || value === "codex" || value === "opencode";
}
