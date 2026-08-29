import test from "node:test";
import assert from "node:assert/strict";
import {
  isCloudTranscribeUnavailable,
  localTranscribeInstallHint,
  normalizeTranscript,
  parseOpenAIWhisperJson,
  parseTranscriptJson,
  parseWhisperCppJson,
  wordsFromSegment,
} from "./local-transcribe.ts";

test("isCloudTranscribeUnavailable matches missing auth", () => {
  assert.ok(isCloudTranscribeUnavailable("Missing authorization token"));
  assert.ok(isCloudTranscribeUnavailable("User not found"));
  assert.ok(!isCloudTranscribeUnavailable("No speech detected"));
});

test("parseOpenAIWhisperJson maps word timestamps", () => {
  const result = parseOpenAIWhisperJson({
    segments: [
      {
        text: " Hello world",
        words: [
          { word: " Hello", start: 0.1, end: 0.4 },
          { word: " world", start: 0.4, end: 0.9 },
        ],
      },
    ],
  });
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].words[0].text, "Hello");
  assert.equal(result.segments[0].words[1].start, 0.4);
});

test("parseWhisperCppJson estimates words within segments", () => {
  const result = parseWhisperCppJson([
    { text: " hello world", offsets: { from: 1000, to: 2500 } },
  ]);
  assert.equal(result.segments[0].words.length, 2);
  assert.equal(result.segments[0].words[0].start, 1);
  assert.equal(result.segments[0].words[1].end, 2.5);
});

test("normalizeTranscript accepts MediaTranscribeResult JSON", () => {
  const raw = {
    segments: [
      {
        text: "um hello",
        words: [
          { text: "um", start: 0.5, end: 0.7 },
          { text: "hello", start: 0.8, end: 1.1 },
        ],
      },
    ],
  };
  assert.deepEqual(normalizeTranscript(raw), raw);
});

test("parseTranscriptJson reads dapi transcript files", () => {
  const parsed = parseTranscriptJson(JSON.stringify({
    segments: [{ text: "hi", words: [{ text: "hi", start: 0, end: 0.2 }] }],
  }));
  assert.equal(parsed.segments[0].words[0].text, "hi");
});

test("wordsFromSegment splits evenly across the span", () => {
  const words = wordsFromSegment("a b", 1, 2);
  assert.equal(words.length, 2);
  assert.equal(words[0].start, 1);
  assert.equal(words[1].end, 2);
});

test("localTranscribeInstallHint does not mention sign-in as the only path", () => {
  assert.match(localTranscribeInstallHint(), /whisper/i);
  assert.match(localTranscribeInstallHint(), /signed-in/i);
});
