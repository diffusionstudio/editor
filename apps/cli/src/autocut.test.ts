import test from "node:test";
import assert from "node:assert/strict";
import { computeAutocut, formatAutocutJsx } from "./autocut.ts";

const emptyTranscript = { segments: [] as Array<{ text: string; words: Array<{ text: string; start: number; end: number }> }> };

test("drops silences at or above silenceMin", () => {
  const result = computeAutocut(
    {
      duration: 10,
      silences: [
        { start: 2, end: 3.5 },
        { start: 4, end: 4.2 },
      ],
      transcript: emptyTranscript,
    },
    { silenceMin: 0.4, pad: 0 },
  );
  assert.deepEqual(result.removed.silences, [{ start: 2, end: 3.5 }]);
  assert.deepEqual(result.keep, [
    { start: 0, end: 2 },
    { start: 3.5, end: 10 },
  ]);
});

test("stutter drops only the repeated word", () => {
  const result = computeAutocut(
    {
      duration: 5,
      silences: [],
      transcript: {
        segments: [
          {
            text: "I I think",
            words: [
              { text: "I", start: 0.2, end: 0.35 },
              { text: "I", start: 0.36, end: 0.48 },
              { text: "think", start: 0.5, end: 0.9 },
            ],
          },
        ],
      },
    },
    { pad: 0 },
  );
  assert.deepEqual(result.removed.stutters, [{ start: 0.36, end: 0.48 }]);
  assert.ok(result.keep.some((r) => r.start <= 0.2 && r.end >= 0.35));
  assert.ok(result.keep.some((r) => r.start <= 0.5 && r.end >= 0.9));
  assert.ok(!result.keep.some((r) => r.start <= 0.36 && r.end >= 0.48 && r.end - r.start < 0.12));
});

test("conservative fillers drop vocal pauses and safe phrases only", () => {
  const result = computeAutocut(
    {
      duration: 8,
      silences: [],
      transcript: {
        segments: [
          {
            text: "so like um you know well",
            words: [
              { text: "so", start: 0.2, end: 0.4 },
              { text: "like", start: 0.5, end: 0.7 },
              { text: "um", start: 0.8, end: 1.0 },
              { text: "you", start: 1.1, end: 1.25 },
              { text: "know", start: 1.26, end: 1.45 },
              { text: "well", start: 1.5, end: 1.7 },
            ],
          },
        ],
      },
    },
    { pad: 0, lang: "en" },
  );
  assert.equal(result.removed.fillers.length, 2);
  assert.ok(result.removed.fillers.some((r) => r.start === 0.8 && r.end === 1));
  assert.ok(result.removed.fillers.some((r) => r.start === 1.1 && r.end === 1.45));
  assert.ok(result.keep.some((r) => r.start <= 0.2 && r.end >= 0.4));
  assert.ok(result.keep.some((r) => r.start <= 0.5 && r.end >= 0.7));
  assert.ok(result.keep.some((r) => r.start <= 1.5 && r.end >= 1.7));
});

test("pad does not swallow the next word after a filler", () => {
  const result = computeAutocut(
    {
      duration: 4,
      silences: [],
      transcript: {
        segments: [
          {
            text: "um hello",
            words: [
              { text: "um", start: 0.5, end: 0.7 },
              { text: "hello", start: 0.72, end: 1.2 },
            ],
          },
        ],
      },
    },
    { pad: 0.05 },
  );
  const hello = result.keep.find((r) => r.start <= 0.72 && r.end >= 1.2);
  assert.ok(hello);
  assert.ok(hello!.start <= 0.72);
});

test("empty transcript with silences still returns keep ranges", () => {
  const result = computeAutocut(
    {
      duration: 6,
      silences: [{ start: 1, end: 3 }],
      transcript: emptyTranscript,
    },
    { silenceMin: 0.4, pad: 0 },
  );
  assert.deepEqual(result.keep, [
    { start: 0, end: 1 },
    { start: 3, end: 6 },
  ]);
});

test("window silences stay in absolute source seconds", () => {
  const result = computeAutocut(
    {
      duration: 30,
      silences: [{ start: 12, end: 14 }],
      transcript: emptyTranscript,
      window: { start: 10, end: 20 },
    },
    { silenceMin: 0.4, pad: 0 },
  );
  assert.deepEqual(result.removed.silences, [{ start: 12, end: 14 }]);
  assert.deepEqual(result.keep, [
    { start: 10, end: 12 },
    { start: 14, end: 20 },
  ]);
});

test("formatAutocutJsx uses probe dimensions when provided", () => {
  const jsx = formatAutocutJsx("clip.mp4", [{ start: 0, end: 2 }], { width: 1280, height: 720 });
  assert.match(jsx, /width=\{1280\}/);
  assert.match(jsx, /height=\{720\}/);
});

test("formatAutocutJsx omits dimensions for audio", () => {
  const jsx = formatAutocutJsx("clip.mp3", [{ start: 0, end: 2 }], { kind: "audio" });
  assert.match(jsx, /<audio /);
  assert.doesNotMatch(jsx, /width=/);
});
