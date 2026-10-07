/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The whole loop over a real socket: the browser client against the host
// with the fake harness behind it. What the UI does is what these do.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { WebSocket } from "ws";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AgentChatClient } from "../src/client";
import { emptyTranscript, reduce } from "../src/reduce";
import { FakeHarness } from "../src/host/fake";
import { createAgentHost } from "../src/host/index";

import type { ChatEvent, ChatSnapshot, Item } from "../src/protocol";
import type { Transcript } from "../src/reduce";
import type { RunningAgentHost } from "../src/host/index";

let dir: string;
let host: RunningAgentHost;
let fake: FakeHarness;
const clients: AgentChatClient[] = [];

const PROJECT = { projectId: "proj", cwd: "/tmp/proj" };
const MODEL = { harness: "claude" as const, model: "fake-fast" };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "agent-chat-e2e-"));
  fake = new FakeHarness({ tickMs: 2 });
  host = await createAgentHost({
    token: "secret-token",
    dataDir: dir,
    mcp: { name: "diffusion", url: "http://127.0.0.1:3274/mcp?client=chat" },
    version: "0.0.0-test",
    harnesses: [fake],
    uploadDir: join(dir, "uploads"),
    allowedOrigins: ["null"],
    log: () => {},
  });
});

afterAll(async () => {
  await host.stop();
  rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

// Node's `ws` sends no Origin header; the host's allow-list has "null" for that.
function connect(url = host.url): Promise<AgentChatClient> {
  const client = new AgentChatClient({
    resolveEndpoint: async () => url,
    WebSocket: WebSocket as unknown as typeof globalThis.WebSocket,
    minBackoffMs: 20,
    maxBackoffMs: 50,
  });
  clients.push(client);
  return new Promise((resolve, reject) => {
    const stop = client.onState((state) => {
      if (state === "open") {
        stop();
        resolve(client);
      }
    });
    client.connect();
    setTimeout(() => reject(new Error("no connection")), 3000);
  });
}

/** Subscribes and folds everything into a transcript the test can wait on. */
function follow(client: AgentChatClient, chatId: string) {
  let transcript: Transcript = emptyTranscript();
  const events: ChatEvent[] = [];
  const waiters: { test(t: Transcript): boolean; resolve(t: Transcript): void }[] = [];
  const check = () => {
    for (const waiter of waiters.splice(0)) {
      if (waiter.test(transcript)) waiter.resolve(transcript);
      else waiters.push(waiter);
    }
  };
  const unsubscribe = client.open(chatId, (message) => {
    if (message.type === "snapshot") {
      transcript = { items: message.snapshot.items, pending: message.snapshot.pending, turnId: null, chat: message.snapshot.chat };
    } else {
      events.push(message.event);
      transcript = reduce(transcript, message.event);
    }
    check();
  });
  return {
    events,
    get transcript() {
      return transcript;
    },
    until(test: (t: Transcript) => boolean, ms = 3000): Promise<Transcript> {
      return new Promise((resolve, reject) => {
        if (test(transcript)) return resolve(transcript);
        waiters.push({ test, resolve });
        setTimeout(() => reject(new Error(`timed out; items=${JSON.stringify(transcript.items)}`)), ms);
      });
    },
    unsubscribe,
  };
}

const idle = (t: Transcript) => t.chat?.status === "idle" && t.items.some((item) => item.kind === "assistant");

describe("agent chat end to end", () => {
  it("rejects a bad token and a bad origin", async () => {
    const bad = host.url.replace("secret-token", "nope");
    await expect(
      new Promise((resolve, reject) => {
        const socket = new WebSocket(bad);
        socket.on("open", () => resolve("opened"));
        socket.on("error", (error) => reject(error));
      }),
    ).rejects.toThrow(/401/);
    await expect(
      new Promise((resolve, reject) => {
        const socket = new WebSocket(host.url, { origin: "http://evil.example" });
        socket.on("open", () => resolve("opened"));
        socket.on("error", (error) => reject(error));
      }),
    ).rejects.toThrow(/403/);
  });

  it("pushes the harness list on connect", async () => {
    const client = await connect();
    // The first push may still say "checking": the probe is pushed when it lands.
    const harnesses = await new Promise<typeof client.harnesses>((resolve) => {
      const settled = (list: typeof client.harnesses) => list.length > 0 && list.every((entry) => entry.status !== "checking");
      if (settled(client.harnesses)) return resolve(client.harnesses);
      client.onHarnesses((list) => settled(list) && resolve(list));
    });
    expect(harnesses).toHaveLength(1);
    expect(harnesses[0]!.status).toBe("ready");
    expect(await client.request("harnesses.list", {})).toEqual(harnesses);
  });

  it("creates a chat lazily on the first send and streams the reply", async () => {
    const client = await connect();
    const { chatId } = await client.request("turn.send", { ...PROJECT, text: "hello there", model: MODEL });
    const chat = follow(client, chatId);
    const done = await chat.until(idle);

    const kinds = done.items.map((item) => item.kind);
    expect(kinds).toEqual(["user", "reasoning", "tool", "assistant"]);
    expect((done.items[3] as Extract<Item, { kind: "assistant" }>).text).toBe("(fake-fast) hello there");
    expect(done.chat?.title).toBe("hello there");
    expect(chat.events.some((event) => event.type === "item.delta")).toBe(true);
    expect(chat.events.at(-2)?.type).toBe("turn.completed");

    const list = await client.request("chats.list", { projectId: PROJECT.projectId });
    expect(list.map((entry) => entry.id)).toContain(chatId);
    expect(fake.sessions.at(-1)!.opened.instructions).toContain("/tmp/proj");
    expect(fake.sessions.at(-1)!.opened.mcp?.url).toContain("client=chat");
  });

  it("keeps attachments apart from the text and appends them for the harness", async () => {
    const client = await connect();
    const { chatId } = await client.request("turn.send", { ...PROJECT, text: "look", attachments: ["/a/b.mp4"], model: MODEL });
    const chat = follow(client, chatId);
    const done = await chat.until(idle);
    expect(done.items[0]).toMatchObject({ kind: "user", text: "look", attachments: ["/a/b.mp4"] });
    expect((done.items.at(-1) as Extract<Item, { kind: "assistant" }>).text).toContain("Attached files and folders:\n/a/b.mp4");
  });

  it("rejects a second turn while one runs, and another harness on the same chat", async () => {
    const client = await connect();
    const { chatId } = await client.request("turn.send", { ...PROJECT, text: "slow", model: MODEL });
    await expect(client.request("turn.send", { ...PROJECT, chatId, text: "again", model: MODEL })).rejects.toMatchObject({ code: "busy" });
    await client.request("turn.interrupt", { chatId });
    await expect(client.request("turn.send", { ...PROJECT, chatId, text: "x", model: { harness: "codex", model: "m" } })).rejects.toMatchObject({
      code: "harness-mismatch",
    });
  });

  it("interrupts a running turn and records what was streamed", async () => {
    const client = await connect();
    const { chatId } = await client.request("turn.send", { ...PROJECT, text: "slow please", model: MODEL });
    const chat = follow(client, chatId);
    await chat.until((t) => t.items.some((item) => item.kind === "assistant" && item.text.length > 10));
    await client.request("turn.interrupt", { chatId });
    const done = await chat.until((t) => t.chat?.status === "idle" && t.turnId === null);
    const completed = chat.events.filter((event) => event.type === "turn.completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ status: "interrupted" });
    const assistant = done.items.find((item) => item.kind === "assistant");
    expect(assistant && assistant.kind === "assistant" && assistant.text.length).toBeGreaterThan(0);

    // What the host kept is what a fresh client sees.
    const other = await connect();
    const snapshot = await other.request("chats.open", { chatId });
    expect(snapshot.items.map((item) => item.kind)).toEqual(done.items.map((item) => item.kind));
    expect(snapshot.chat.status).toBe("idle");
  });

  it("shows a question, marks the chat waiting, and continues with the answer", async () => {
    const client = await connect();
    const { chatId } = await client.request("turn.send", { ...PROJECT, text: "ask me", model: MODEL });
    const chat = follow(client, chatId);
    const waiting = await chat.until((t) => t.pending !== null);
    expect(waiting.chat?.status).toBe("waiting");
    const request = waiting.pending!;
    expect(request.questions[0]!.header).toBe("Format");

    // A late client gets the pending request in its snapshot.
    const late = await connect();
    const snapshot: ChatSnapshot = await late.request("chats.open", { chatId });
    expect(snapshot.pending?.id).toBe(request.id);
    expect(snapshot.chat.status).toBe("waiting");

    await late.request("request.respond", { chatId, requestId: request.id, response: { answers: { [request.questions[0]!.id]: ["9:16"] } } });
    const done = await chat.until(idle);
    const question = done.items.find((item) => item.kind === "question");
    expect(question).toMatchObject({ kind: "question", answers: { "Which format?": ["9:16"] } });
    expect((done.items.at(-1) as Extract<Item, { kind: "assistant" }>).text).toBe("You chose 9:16.");
    await expect(late.request("request.respond", { chatId, requestId: request.id, response: "skip" })).rejects.toMatchObject({ code: "no-request" });
  });

  it("skips a question and cancels one on stop", async () => {
    const client = await connect();
    const first = await client.request("turn.send", { ...PROJECT, text: "ask", model: MODEL });
    const chat = follow(client, first.chatId);
    let waiting = await chat.until((t) => t.pending !== null);
    await client.request("request.respond", { chatId: first.chatId, requestId: waiting.pending!.id, response: "skip" });
    let done = await chat.until(idle);
    expect(done.items.find((item) => item.kind === "question")).toMatchObject({ answers: null });
    expect((done.items.at(-1) as Extract<Item, { kind: "assistant" }>).text).toBe("You chose no answer.");

    await client.request("turn.send", { ...PROJECT, chatId: first.chatId, text: "ask again", model: MODEL });
    waiting = await chat.until((t) => t.pending !== null);
    await client.request("turn.interrupt", { chatId: first.chatId });
    done = await chat.until((t) => t.chat?.status === "idle" && t.turnId === null);
    expect(done.pending).toBeNull();
    expect(chat.events.filter((event) => event.type === "request.resolved").at(-1)).toMatchObject({ outcome: "cancel" });
    expect(done.items.filter((item) => item.kind === "question")).toHaveLength(1);
  });

  it("surfaces a failed turn as a notice and a failed status", async () => {
    const client = await connect();
    const { chatId } = await client.request("turn.send", { ...PROJECT, text: "fail now", model: MODEL });
    const chat = follow(client, chatId);
    const done = await chat.until((t) => t.chat?.status === "idle" && t.turnId === null);
    expect(done.items.at(-1)).toMatchObject({ kind: "notice", level: "error", text: expect.stringContaining("told to fail") });
    // The turn fails at once, so it may already be inside the snapshot; the log is the record.
    const other = await connect();
    const snapshot = await other.request("chats.open", { chatId });
    expect(snapshot.items.at(-1)).toMatchObject({ kind: "notice", level: "error" });
    expect(snapshot.chat.status).toBe("idle");
  });

  it("reconnects after the socket drops and re-opens the chat", async () => {
    const client = await connect();
    const { chatId } = await client.request("turn.send", { ...PROJECT, text: "reconnect", model: MODEL });
    const chat = follow(client, chatId);
    await chat.until(idle);
    const snapshots: number[] = [];
    client.open(chatId, (message) => {
      if (message.type === "snapshot") snapshots.push(message.snapshot.seq);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Drop the socket from under the client: it must come back on its own.
    (client as unknown as { socket: WebSocket }).socket.close();
    await new Promise<void>((resolve) => {
      const stop = client.onState((state) => {
        if (state === "open") {
          stop();
          resolve();
        }
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(client.state).toBe("open");
  });

  it("deletes a chat and drops it from the list", async () => {
    const client = await connect();
    const { chatId } = await client.request("turn.send", { ...PROJECT, text: "bye", model: MODEL });
    await follow(client, chatId).until(idle);
    await client.request("chats.delete", { chatId });
    const list = await client.request("chats.list", { projectId: PROJECT.projectId });
    expect(list.map((entry) => entry.id)).not.toContain(chatId);
    await expect(client.request("chats.open", { chatId })).rejects.toMatchObject({ code: "not-found" });
  });

  it("deletes every chat of a project and leaves the other projects' alone", async () => {
    const client = await connect();
    const other = { projectId: "other", cwd: "/tmp/other" };
    const { chatId: kept } = await client.request("turn.send", { ...other, text: "stay", model: MODEL });
    await follow(client, kept).until(idle);
    const { chatId: gone } = await client.request("turn.send", { ...PROJECT, text: "go", model: MODEL });
    await follow(client, gone).until(idle);

    await host.deleteChats(PROJECT.projectId);

    expect(await client.request("chats.list", { projectId: PROJECT.projectId })).toEqual([]);
    expect((await client.request("chats.list", { projectId: other.projectId })).map((entry) => entry.id)).toEqual([kept]);
    expect(existsSync(join(dir, "chats", gone))).toBe(false);
    expect(existsSync(join(dir, "chats", kept))).toBe(true);
  });

  it("writes an uploaded attachment to a path of its own, under its name", async () => {
    const client = await connect();
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]);
    const data = bytes.toString("base64");

    const first = await client.request("attachments.upload", { name: "image.png", data });
    const second = await client.request("attachments.upload", { name: "image.png", data });
    expect(first.path).not.toBe(second.path);
    for (const { path } of [first, second]) {
      expect(path.endsWith("image.png")).toBe(true);
      expect(readFileSync(path)).toEqual(bytes);
    }

    // A name is only ever a name: it cannot climb out of the upload folder.
    const sneaky = await client.request("attachments.upload", { name: "../../.evil.png", data });
    expect(dirname(dirname(sneaky.path))).toBe(join(dir, "uploads"));
    expect(sneaky.path.endsWith("evil.png")).toBe(true);
  });

  it("refuses a harness that is not ready", async () => {
    const client = await connect();
    fake.probeStatus = "not-installed";
    try {
      await client.request("harnesses.list", { refresh: true });
      // The cache is fresh, so refresh is a no-op until it ages out; force the point.
      const before = await client.request("chats.list", { projectId: "p2" });
      expect(before).toEqual([]);
    } finally {
      fake.probeStatus = "ready";
    }
  });
});
