/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { LOG_MESSAGE_MAX, LOG_TAIL } from "@diffusionstudio/dapi";
import { logs } from "./logs";

import type { LogEntry } from "@diffusionstudio/dapi";
import type { MainContext } from "../handler";

const entry = (ts: number, message: string, level: LogEntry["level"] = "info"): LogEntry => ({ ts, level, message, source: "" });

const noWindow = { visible: () => false, show: async () => {}, hide: () => {} };
const ctx = (entries: LogEntry[]): MainContext => ({ signal: new AbortController().signal, logs: () => entries, version: "0", window: noWindow });

describe("logs", () => {
  it("returns the last LOG_TAIL entries when no tail is given", async () => {
    const buffer = Array.from({ length: LOG_TAIL + 5 }, (_, i) => entry(i, `m${i}`));
    const { entries } = await logs({}, ctx(buffer));
    expect(entries).toHaveLength(LOG_TAIL);
    expect(entries[0]!.ts).toBe(5);
  });

  it("filters by level, since, and contains before taking the tail", async () => {
    const buffer = [
      entry(1, "Export 10%"),
      entry(2, "export 50%"),
      entry(3, "render done"),
      entry(4, "EXPORT failed", "error"),
      entry(5, "export 90%", "debug"),
    ];
    const { entries } = await logs({ since: 1, contains: "export", level: "info", tail: 1 }, ctx(buffer));
    expect(entries.map((e) => e.ts)).toEqual([4]);
    const all = await logs({ since: 1, contains: "export" }, ctx(buffer));
    expect(all.entries.map((e) => e.ts)).toEqual([2, 4, 5]);
  });

  it("cuts long messages and says how much was dropped", async () => {
    const { entries } = await logs({}, ctx([entry(1, "x".repeat(LOG_MESSAGE_MAX + 10))]));
    expect(entries[0]!.message).toBe(`${"x".repeat(LOG_MESSAGE_MAX)}… (10 more chars)`);
  });
});
