import test from "node:test";
import assert from "node:assert/strict";
import { computeAutocut, planAutocutTimeline } from "@diffusionstudio/runtime/media/autocut";
import {
  mediaSrcFromAuthored,
  singleTimelineMediaTag,
  trimmedClipTiming,
} from "./autocut-helpers.ts";

test("singleTimelineMediaTag shows Autocut for one path-based video selection", () => {
  assert.equal(singleTimelineMediaTag(["video"]), "video");
  assert.equal(singleTimelineMediaTag(["video", "video"]), null);
  assert.equal(singleTimelineMediaTag(["video", "audio"]), null);
  assert.equal(singleTimelineMediaTag([]), null);
});

test("mediaSrcFromAuthored reads absolute src without a library AssetId", () => {
  assert.equal(mediaSrcFromAuthored("video", "/absolute/talking-head.mp4"), "/absolute/talking-head.mp4");
  assert.equal(mediaSrcFromAuthored("video", ""), null);
  assert.equal(mediaSrcFromAuthored("image", "/absolute/talking-head.mp4"), null);
});

test("apply path writes back-to-back copies with sourceIn and sourceOut", () => {
  const result = computeAutocut(
    {
      duration: 10,
      silences: [{ start: 2, end: 3.5 }],
      transcript: { segments: [] },
      window: { start: 0, end: 10 },
    },
    { silenceMin: 0.4, pad: 0, lang: "all" },
  );

  const specs = planAutocutTimeline(result.keep, 5);
  assert.equal(specs.length, 2);

  assert.deepEqual(trimmedClipTiming(specs[0]), {
    start: 5,
    end: 7,
    sourceIn: 0,
    sourceOut: 2,
  });
  assert.deepEqual(trimmedClipTiming(specs[1]), {
    start: 7,
    end: 13.5,
    sourceIn: 3.5,
    sourceOut: 10,
  });
});
