/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// opencode through `opencode serve`: HTTP for the calls, Server-Sent Events
// for the stream. One child server per live session, on a loopback port we
// pick, so its event stream carries only this project's work. The routes and
// event shapes we read are hand-typed; anything else is ignored. The MCP
// entry and the chat instructions are injected as inline config and a system
// prompt, so nothing is written to the user's own opencode.json.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";

import { HARNESS_LABELS } from "../protocol";
import { killTree, needsShell, parseVersion, quoteArg, resolveBinary, runOnce } from "./env";
import { QuestionBox, newItemId, summarizeInput, toolTitle, truncateDetail } from "./harness";

import type { ChildProcess } from "node:child_process";
import type { AddressInfo } from "node:net";
import type { HarnessInfo, Item, Question, RequestResponse, ToolStatus } from "../protocol";
import type { HostEnv } from "./env";
import type { Emit, Harness, HarnessSession, OpenOptions, ResumeCursor, TurnOutcome } from "./harness";

const PROBE_TIMEOUT_MS = 20_000;
const READY_TIMEOUT_MS = 20_000;
const READY_LINE = /opencode server listening on (http:\/\/\S+)/;

/** The slice of a part the panel draws: text, or a tool's state, and nothing else. */
type PartState = { status?: string; input?: unknown; title?: string; output?: string; error?: string };
type Part = {
  id?: string;
  type?: string;
  messageID?: string;
  text?: string;
  tool?: string;
  state?: PartState;
  time?: { start?: number; end?: number };
};

type MessageInfo = { id?: string; role?: string; error?: unknown };
type QuestionInfo = { question?: string; header?: string; options?: { label?: string; description?: string }[]; multiple?: boolean; custom?: boolean };
type AskInfo = { id?: string; sessionID?: string; questions?: QuestionInfo[] };
type PermissionInfo = { id?: string; sessionID?: string; permission?: string; patterns?: string[] };

type WireEvent = { type?: string; properties?: Record<string, unknown> };

/** opencode's error envelope: `{ name, data: { message } }`, or a plain string. */
export function errorText(error: unknown): string | undefined {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return undefined;
  const data = (error as { data?: { message?: string } }).data;
  if (typeof data?.message === "string") return data.message;
  const message = (error as { message?: string }).message;
  return typeof message === "string" ? message : undefined;
}

/** "provider/model" as the picker's value; null when it is not a pair. */
export function parseModel(model: string): { providerID: string; modelID: string } | null {
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) return null;
  return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) };
}

/** The MCP entry, as inline config: merged over the user's own, never written to it. */
function inlineConfig(mcp: OpenOptions["mcp"]): string {
  return JSON.stringify(mcp ? { mcp: { [mcp.name]: { type: "remote", url: mcp.url } } } : {});
}

/** A free loopback port: opencode ignores `--port 0`, so we pick one ourselves. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
}

function spawnServer(binary: string, cwd: string, env: Record<string, string>, password: string, port: number): ChildProcess {
  const args = ["serve", "--hostname", "127.0.0.1", "--port", String(port)];
  const shell = needsShell(binary);
  return spawn(shell ? `"${binary}"` : binary, shell ? args.map(quoteArg) : args, {
    cwd,
    env: { ...env, OPENCODE_SERVER_USERNAME: "opencode", OPENCODE_SERVER_PASSWORD: password },
    stdio: ["ignore", "pipe", "ignore"],
    shell,
    windowsHide: true,
  });
}

/** The server's loopback URL, read from the line it prints once it listens. */
function waitForServer(child: ChildProcess, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const finish = (error: Error | null, url?: string): void => {
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve(url as string);
    };
    const onData = (chunk: Buffer): void => {
      output = (output + chunk.toString()).slice(-4096);
      const match = READY_LINE.exec(output);
      if (match) finish(null, match[1]);
    };
    const onExit = (): void => finish(new Error("opencode exited before it listened"));
    const timer = setTimeout(() => finish(new Error("opencode did not start in time")), timeoutMs);
    child.stdout?.on("data", onData);
    child.once("exit", onExit);
  });
}

async function call(base: string, authorization: string, method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { authorization, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`opencode ${method} ${path} failed with ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

type Turn = { emit: Emit; resolve(outcome: TurnOutcome): void };

class OpenCodeSession implements HarnessSession {
  readonly resume: ResumeCursor;
  private readonly child: ChildProcess;
  private readonly base: string;
  private readonly authorization: string;
  private readonly directory: string;
  private readonly instructions: string | undefined;
  private readonly mcpName: string | undefined;
  private readonly sessionId: string;
  private turn: Turn | null = null;
  private questions: QuestionBox | null = null;
  /** messageIDs the server has told us are the assistant's, so its parts are ours to draw. */
  private readonly assistant = new Set<string>();
  private readonly open = new Map<string, { id: string; kind: "assistant" | "reasoning"; text: string }>();
  private readonly running = new Set<string>();
  private stream: AbortController | null = null;
  private interrupting = false;
  private closing = false;

  private constructor(child: ChildProcess, base: string, authorization: string, sessionId: string, options: OpenOptions) {
    this.child = child;
    this.base = base;
    this.authorization = authorization;
    this.sessionId = sessionId;
    this.directory = options.cwd;
    this.instructions = options.instructions;
    this.mcpName = options.mcp?.name;
    this.resume = { opencode: { sessionId } };
  }

  static async start(options: OpenOptions, binary: string): Promise<OpenCodeSession> {
    const password = randomUUID();
    const port = await freePort();
    const child = spawnServer(binary, options.cwd, { ...options.env.env, OPENCODE_CONFIG_CONTENT: inlineConfig(options.mcp) }, password, port);
    try {
      const base = await waitForServer(child, READY_TIMEOUT_MS);
      const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
      const sessionId = await OpenCodeSession.openSession(base, authorization, options);
      const session = new OpenCodeSession(child, base, authorization, sessionId, options);
      void session.pump();
      return session;
    } catch (error) {
      await killTree(child);
      throw error;
    }
  }

  /** The session to continue, or a fresh one; a resume cursor the server no longer knows starts over. */
  private static async openSession(base: string, authorization: string, options: OpenOptions): Promise<string> {
    const directory = encodeURIComponent(options.cwd);
    const resumed = options.resume && "opencode" in options.resume ? options.resume.opencode.sessionId : null;
    if (resumed) {
      try {
        await call(base, authorization, "GET", `/session/${resumed}?directory=${directory}`);
        return resumed;
      } catch {
        options.emit({
          type: "item.completed",
          item: { id: newItemId("n"), kind: "notice", level: "info", text: "Previous opencode session not found — started fresh" },
        });
      }
    }
    const created = (await call(base, authorization, "POST", `/session?directory=${directory}`, { title: "Diffusion Studio" })) as { id?: string } | undefined;
    if (!created?.id) throw new Error("opencode did not return a session id");
    return created.id;
  }

  private request(method: string, path: string, body?: unknown): Promise<unknown> {
    const separator = path.includes("?") ? "&" : "?";
    return call(this.base, this.authorization, method, `${path}${separator}directory=${encodeURIComponent(this.directory)}`, body);
  }

  private async pump(): Promise<void> {
    const controller = new AbortController();
    this.stream = controller;
    try {
      const response = await fetch(`${this.base}/event?directory=${encodeURIComponent(this.directory)}`, {
        headers: { authorization: this.authorization },
        signal: controller.signal,
      });
      if (!response.body) throw new Error("opencode sent no event stream");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index: number;
        while ((index = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("");
          if (data) this.dispatch(JSON.parse(data) as WireEvent);
        }
      }
    } catch {
      // Aborted on interrupt or close; the exit path below says the rest.
    }
    if (!this.closing && !this.interrupting) this.finish({ status: "failed", error: "opencode exited" });
  }

  private dispatch(event: WireEvent): void {
    const properties = event.properties ?? {};
    const sessionID = properties.sessionID;
    if (typeof sessionID === "string" && sessionID !== this.sessionId) return;
    switch (event.type) {
      case "message.updated": {
        const info = (properties.info ?? {}) as MessageInfo;
        if (info.role === "assistant" && info.id) this.assistant.add(info.id);
        const text = info.error ? errorText(info.error) : undefined;
        if (text) this.notice("error", text);
        return;
      }
      case "message.part.updated":
        this.onPart((properties.part ?? {}) as Part);
        return;
      case "session.status": {
        const status = (properties.status ?? {}) as { type?: string; message?: string };
        if (status.type === "retry" && status.message) this.notice("info", `Retrying: ${status.message}`);
        return;
      }
      case "session.error": {
        if (this.interrupting) return;
        const text = errorText(properties.error) ?? "opencode reported an error";
        this.notice("error", text);
        this.finish({ status: "failed", error: text });
        return;
      }
      case "session.idle":
        this.finish(this.interrupting ? { status: "interrupted" } : { status: "completed" });
        return;
      case "permission.asked":
        void this.askPermission(properties as PermissionInfo);
        return;
      case "question.asked":
        void this.askQuestion(properties as AskInfo);
        return;
      default:
        return;
    }
  }

  private onPart(part: Part): void {
    const turn = this.turn;
    if (!turn || !part.id || !part.messageID) return;
    if (!this.assistant.has(part.messageID)) return;
    if (part.type === "text" || part.type === "reasoning") {
      this.onText(part, part.type === "text" ? "assistant" : "reasoning", turn);
      return;
    }
    if (part.type === "tool") {
      const item = this.toolItem(part);
      if (!this.running.has(part.id)) {
        this.running.add(part.id);
        turn.emit({ type: "item.started", item });
      }
      if (item.status !== "running") {
        this.running.delete(part.id);
        turn.emit({ type: "item.completed", item });
      }
    }
  }

  /** A text or reasoning part: what streams in is a growing string, so the delta is the tail. */
  private onText(part: Part, kind: "assistant" | "reasoning", turn: Turn): void {
    const text = part.text ?? "";
    let entry = this.open.get(part.id as string);
    if (!entry) {
      entry = { id: newItemId(kind === "assistant" ? "a" : "r"), kind, text: "" };
      this.open.set(part.id as string, entry);
      turn.emit({ type: "item.started", item: { id: entry.id, kind, text: "" } });
    }
    if (text.length > entry.text.length) {
      const delta = text.slice(entry.text.length);
      entry.text = text;
      turn.emit({ type: "item.delta", itemId: entry.id, text: delta });
    }
    if (part.time?.end !== undefined) {
      this.open.delete(part.id as string);
      turn.emit({ type: "item.completed", item: { id: entry.id, kind, text: entry.text } });
    }
  }

  private toolItem(part: Part): Extract<Item, { kind: "tool" }> {
    const state = part.state ?? {};
    const status: ToolStatus = state.status === "completed" ? "done" : state.status === "error" ? "failed" : "running";
    const output = state.status === "completed" ? state.output : state.status === "error" ? state.error : undefined;
    const name = part.tool ?? "tool";
    const detail = state.title ?? summarizeInput(state.input);
    return {
      id: part.id as string,
      kind: "tool",
      name,
      title: this.toolLabel(name),
      ...(detail ? { detail } : {}),
      ...(output ? { output: truncateDetail(output) } : {}),
      status,
    };
  }

  private toolLabel(name: string): string {
    if (this.mcpName && name.startsWith(`${this.mcpName}_`)) return name.slice(this.mcpName.length + 1);
    return toolTitle(name);
  }

  private notice(level: "info" | "error", text: string): void {
    this.turn?.emit({ type: "item.completed", item: { id: newItemId("n"), kind: "notice", level, text } });
  }

  async send(text: string, model: string, emit: Emit): Promise<TurnOutcome> {
    if (this.turn) throw new Error("A turn is already running");
    this.interrupting = false;
    this.open.clear();
    this.running.clear();
    this.questions = new QuestionBox(emit);
    return new Promise<TurnOutcome>((resolve) => {
      this.turn = { emit, resolve };
      const parsed = parseModel(model);
      const body = {
        parts: [{ type: "text", text }],
        ...(parsed ? { model: parsed } : {}),
        ...(this.instructions ? { system: this.instructions } : {}),
      };
      this.request("POST", `/session/${this.sessionId}/prompt_async`, body).catch((error: Error) => {
        this.turn = null;
        this.questions = null;
        emit({ type: "item.completed", item: { id: newItemId("n"), kind: "notice", level: "error", text: error.message } });
        resolve({ status: "failed", error: error.message });
      });
    });
  }

  respond(requestId: string, response: RequestResponse): void {
    this.questions?.settle(requestId, response);
  }

  async interrupt(): Promise<void> {
    if (!this.turn) return;
    this.interrupting = true;
    this.questions?.cancelAll();
    try {
      await this.request("POST", `/session/${this.sessionId}/abort`);
    } catch {
      // The server is gone or never got the turn: finish it ourselves.
    }
    this.finish({ status: "interrupted" });
  }

  async close(): Promise<void> {
    if (this.turn) await this.interrupt();
    this.closing = true;
    this.stream?.abort();
    await killTree(this.child);
  }

  private finish(outcome: TurnOutcome): void {
    const turn = this.turn;
    if (!turn) return;
    this.turn = null;
    this.questions?.cancelAll();
    this.questions = null;
    this.open.clear();
    this.running.clear();
    turn.resolve(outcome);
  }

  // -------------------------------------------------------------------
  // Permissions and questions

  /** A tool opencode will not run without approval: shown as a card, answered with the panel's choice. */
  private async askPermission(info: PermissionInfo): Promise<void> {
    const box = this.questions;
    const requestId = info.id;
    if (!box || !requestId) return;
    const patterns = (info.patterns ?? []).filter((pattern) => pattern.length > 0);
    const response = await box.ask([
      {
        id: requestId,
        header: "Permission",
        question: `Allow ${info.permission ?? "this action"}?${patterns.length ? `\n${patterns.join("\n")}` : ""}`,
        options: [
          { label: "Allow once", description: "Run it this time only" },
          { label: "Always allow", description: "Remember for this session" },
          { label: "Deny", description: "Do not run it" },
        ],
        multiSelect: false,
        allowOther: false,
        secret: false,
      },
    ]);
    const answer = response === "skip" || response === "cancel" ? undefined : (response.answers[requestId] ?? [])[0];
    const reply = answer === "Allow once" ? "once" : answer === "Always allow" ? "always" : "reject";
    await this.request("POST", `/permission/${requestId}/reply`, { reply }).catch(() => {});
  }

  private async askQuestion(info: AskInfo): Promise<void> {
    const box = this.questions;
    const requestId = info.id;
    const raw = info.questions ?? [];
    if (!box || !requestId || raw.length === 0) return;
    const questions: Question[] = raw.map((entry, index) => ({
      id: String(index),
      header: (entry.header ?? "").slice(0, 12),
      question: entry.question ?? "",
      options: (entry.options ?? []).map((option) => ({ label: option.label ?? "", description: option.description ?? "" })),
      multiSelect: entry.multiple === true,
      allowOther: entry.custom !== false,
      secret: false,
    }));
    const response = await box.ask(questions);
    if (response === "skip" || response === "cancel") {
      await this.request("POST", `/question/${requestId}/reject`).catch(() => {});
      return;
    }
    const answers = questions.map((question) => response.answers[question.id] ?? []);
    await this.request("POST", `/question/${requestId}/reply`, { answers }).catch(() => {});
  }
}

export class OpenCodeHarness implements Harness {
  readonly id = "opencode" as const;

  async probe(env: HostEnv, _signal: AbortSignal): Promise<HarnessInfo> {
    const label = HARNESS_LABELS.opencode;
    const binary = resolveBinary("opencode", env);
    if (!binary) return { id: this.id, label, status: "not-installed", detail: "Install opencode, then reopen the picker", models: [] };
    const version = parseVersion(await runOnce(binary, ["--version"], env));
    const listed = await runOnce(binary, ["models"], env, PROBE_TIMEOUT_MS);
    const models = (listed ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^[\w.-]+\/[\w.-]+$/.test(line))
      .map((id) => ({ id, label: id }));
    if (models.length === 0) {
      return { id: this.id, label, status: "signed-out", detail: "Run `opencode auth login` in a terminal", version, models: [] };
    }
    return { id: this.id, label, status: "ready", version, models, defaultModel: models[0]!.id };
  }

  async open(options: OpenOptions): Promise<HarnessSession> {
    const binary = resolveBinary("opencode", options.env);
    if (!binary) throw new Error("opencode is not installed");
    return OpenCodeSession.start(options, binary);
  }
}
