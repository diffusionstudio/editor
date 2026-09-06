import test from "node:test";
import assert from "node:assert/strict";
import {
  autocutWouldChange,
  computeAutocut,
  formatAutocutJsx,
  planAutocutTimeline,
} from "./autocut.ts";

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
});

test("planAutocutTimeline chains clips on the timeline", () => {
  const specs = planAutocutTimeline(
    [
      { start: 1, end: 3 },
      { start: 5, end: 6 },
    ],
    2,
  );
  assert.deepEqual(specs, [
    { timelineStart: 2, timelineEnd: 4, sourceIn: 1, sourceOut: 3 },
    { timelineStart: 4, timelineEnd: 5, sourceIn: 5, sourceOut: 6 },
  ]);
});

test("autocutWouldChange is false when nothing was removed", () => {
  assert.equal(
    autocutWouldChange({ silences: [], fillers: [], stutters: [] }),
    false,
  );
  assert.equal(
    autocutWouldChange({ silences: [{ start: 1, end: 2 }], fillers: [], stutters: [] }),
    true,
  );
});

test("formatAutocutJsx uses probe dimensions when provided", () => {
  const jsx = formatAutocutJsx("clip.mp4", [{ start: 0, end: 2 }], { width: 1280, height: 720 });
  assert.match(jsx, /width=\{1280\}/);
  assert.match(jsx, /height=\{720\}/);
});
