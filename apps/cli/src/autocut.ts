/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { MediaTranscribeResult, TranscriptWord } from "./cli-channels";

export type TimeRange = { start: number; end: number };

export type AutocutOptions = {
  /** Drop silences at least this long (seconds). Waveform already filters by amplitude. */
  silenceMin?: number;
  /** Pad kept speech on each side (seconds). */
  pad?: number;
  /** Filler vocabulary: English, Spanish, or both. */
  lang?: "en" | "es" | "all";
};

export type AutocutInput = {
  duration: number;
  silences: TimeRange[];
  transcript: MediaTranscribeResult;
  /** When set, everything outside [start, end) is dropped. */
  window?: { start: number; end: number };
};

export type AutocutRemoved = {
  silences: TimeRange[];
  fillers: TimeRange[];
  stutters: TimeRange[];
};

export type AutocutResult = {
  duration: number;
  keep: TimeRange[];
  removed: AutocutRemoved;
};

const STUTTER_MAX_GAP = 0.35;

// Vocalized pauses only — not conjunctions/adverbs that carry meaning ("so", "like", "well", …).
const FILLERS_EN = new Set(["eh", "um", "uh", "er", "ah", "hmm", "hm", "uhm", "erm"]);
const FILLERS_ES = new Set(["eh", "em", "um", "uh", "er", "ah", "hmm", "hm"]);

const FILLER_PHRASES_EN: string[][] = [["you", "know"], ["i", "mean"]];
const FILLER_PHRASES_ES: string[][] = [["o", "sea"], ["es", "decir"]];

function normalizeToken(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']/gu, "")
    .trim();
}

function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: TimeRange[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = merged[merged.length - 1];
    if (cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else merged.push({ ...cur });
  }
  return merged;
}

function flattenWords(transcript: MediaTranscribeResult): TranscriptWord[] {
  return transcript.segments.flatMap((s) => s.words);
}

function findStutters(words: TranscriptWord[]): TimeRange[] {
  const drops: TimeRange[] = [];
  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1];
    const cur = words[i];
    const prevNorm = normalizeToken(prev.text);
    const curNorm = normalizeToken(cur.text);
    if (!prevNorm || prevNorm !== curNorm) continue;
    const gap = cur.start - prev.end;
    if (gap <= STUTTER_MAX_GAP) drops.push({ start: cur.start, end: cur.end });
  }
  return drops;
}

function fillerSets(lang: AutocutOptions["lang"]): { singles: Set<string>; phrases: string[][] } {
  if (lang === "en") return { singles: FILLERS_EN, phrases: FILLER_PHRASES_EN };
  if (lang === "es") return { singles: FILLERS_ES, phrases: FILLER_PHRASES_ES };
  const singles = new Set([...FILLERS_EN, ...FILLERS_ES]);
  return { singles, phrases: [...FILLER_PHRASES_EN, ...FILLER_PHRASES_ES] };
}

function findFillers(words: TranscriptWord[], lang: AutocutOptions["lang"]): TimeRange[] {
  const { singles, phrases } = fillerSets(lang ?? "all");
  const tokens = words.map((w) => ({ ...w, norm: normalizeToken(w.text) }));
  const drops: TimeRange[] = [];
  const used = new Set<number>();

  for (const phrase of phrases) {
    for (let i = 0; i <= tokens.length - phrase.length; i++) {
      if (phrase.every((part, j) => tokens[i + j]?.norm === part)) {
        for (let j = 0; j < phrase.length; j++) used.add(i + j);
        drops.push({ start: tokens[i].start, end: tokens[i + phrase.length - 1].end });
      }
    }
  }

  for (let i = 0; i < tokens.length; i++) {
    if (used.has(i)) continue;
    if (singles.has(tokens[i].norm)) drops.push({ start: tokens[i].start, end: tokens[i].end });
  }

  return drops;
}

function filterSilences(silences: TimeRange[], silenceMin: number): TimeRange[] {
  return silences.filter((s) => s.end - s.start >= silenceMin);
}

export function computeAutocut(input: AutocutInput, opts: AutocutOptions = {}): AutocutResult {
  const silenceMin = opts.silenceMin ?? 0.4;
  const pad = opts.pad ?? 0.05;
  const duration = input.duration;
  const window = input.window;

  const words = flattenWords(input.transcript).filter((w) => {
    if (!window) return true;
    return w.end > window.start && w.start < window.end;
  });

  const silenceDrops = filterSilences(input.silences, silenceMin);
  const fillerDrops = findFillers(words, opts.lang);
  const stutterDrops = findStutters(words);

  const windowDrops: TimeRange[] = [];
  if (window) {
    if (window.start > 0) windowDrops.push({ start: 0, end: window.start });
    if (window.end < duration) windowDrops.push({ start: window.end, end: duration });
  }

  const removed: AutocutRemoved = {
    silences: silenceDrops,
    fillers: fillerDrops,
    stutters: stutterDrops,
  };

  const drop = mergeRanges([...silenceDrops, ...fillerDrops, ...stutterDrops, ...windowDrops]);
  const keep = invertRangesWithPad(drop, duration, pad);

  return { duration, keep, removed };
}

function invertRangesWithPad(drop: TimeRange[], duration: number, pad: number): TimeRange[] {
  const merged = mergeRanges(drop);
  if (merged.length === 0) return duration > 0 ? [{ start: 0, end: duration }] : [];

  const keep: TimeRange[] = [];
  let cursor = 0;
  for (const span of merged) {
    const cutStart = Math.max(0, span.start);
    const cutEnd = Math.min(duration, span.end);
    if (cutStart > cursor) {
      keep.push({
        start: cursor,
        end: Math.min(duration, cutStart + pad),
      });
    }
    cursor = Math.max(cursor, cutEnd);
  }
  if (cursor < duration) {
    const start = Math.max(0, cursor - pad);
    const last = keep[keep.length - 1];
    if (last && start <= last.end) last.end = duration;
    else keep.push({ start, end: duration });
  }

  return mergeRanges(
    keep
      .map((r) => ({
        start: Math.max(0, r.start),
        end: Math.min(duration, r.end),
      }))
      .filter((r) => r.end - r.start > 0.01),
  );
}

export type AutocutJsxOptions = {
  width?: number;
  height?: number;
  kind?: "video" | "audio";
};

export function formatAutocutJsx(src: string, keep: TimeRange[], opts: AutocutJsxOptions = {}): string {
  const tag = opts.kind === "audio" ? "audio" : "video";
  const dims =
    tag === "video" && typeof opts.width === "number" && typeof opts.height === "number"
      ? ` width={${opts.width}} height={${opts.height}}`
      : "";

  const clips = keep
    .map((range, i) => {
      const timelineStart = keep.slice(0, i).reduce((acc, r) => acc + (r.end - r.start), 0);
      const dur = range.end - range.start;
      const timelineEnd = timelineStart + dur;
      const srcIn = formatJsxTime(range.start);
      const srcOut = formatJsxTime(range.end);
      const start = formatJsxTime(timelineStart);
      const end = formatJsxTime(timelineEnd);
      return `  <${tag} src="${escapeJsxAttr(src)}"${dims} start={${start}} end={${end}} sourceIn={${srcIn}} sourceOut={${srcOut}} />`;
    })
    .join("\n");

  return `<sequence>\n${clips}\n</sequence>`;
}

function formatJsxTime(seconds: number): string {
  const rounded = Math.round(seconds * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/\.?0+$/, "");
}

function escapeJsxAttr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
