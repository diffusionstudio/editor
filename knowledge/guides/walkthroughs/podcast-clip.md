# Example: podcast clipping

A long two-or-more-speaker conversation — one to three hours — cut down to a single vertical short. The work is mostly search: the clip-worthy moment has to be found before anything is edited. Audio carries everything you need for that search, so the whole discovery pass runs on an audio-only download; video is only fetched once the moment is known.

## 1. Brief

Write the brief first: the source URL or file, how many clips are wanted, the target duration (25–35 s unless told otherwise), the delivery format (1080×1920), and any editorial steer — a topic to favour, a speaker to feature, moments to avoid. A clip has no surrounding context to lean on, so **self-containment is the hard requirement**; record it in the brief and check the result against it.

## 2. Audio-only pass

Download the audio track alone. It is a fraction of the bytes, and the best moments are found without visuals.

```bash
dapi fetch <url> -a -o podcast.m4a
```

## 3. Segment the audio

A three-hour track is too long for one analysis pass, so split it into segments and analyze each. Segments are **windows**, not files: `listen -s/-e` takes the range directly, and the timestamps it returns are relative to `-s`. Pick one of three ways to choose the boundaries:

1. **Waveform.** `dapi media waveform` renders loudness over the whole track and returns the silent spans as second ranges. Cut segments at those spans — the boundaries land between thoughts instead of inside them.
2. **Naive.** Fixed 15–30 minute segments. Nothing to parse, and good enough because the analysis reports its own timestamps; a moment straddling a boundary is the only loss.
3. **Source transcript.** Many platforms publish one (YouTube captions, show notes with chapter markers). Parse its timestamps and use chapters or topic shifts as boundaries — the cheapest option when it exists, since it needs no decoding at all.

## 4. Find the clip-worthy moments

Run `dapi media listen` on each segment with a prompt that spells out the criteria and demands timestamps.

```bash
dapi media listen podcast.m4a -s '15:00' -e '45:00' -p 'This is a podcast. Find the 3 most clip-worthy self-contained moments in this segment for a vertical social short. Criteria: a complete thought, punchline, or surprising revelation that works with NO prior context; roughly 25-35 seconds long; opens on a strong hook line and lands on a clean button. For each give: exact start and end timestamp (MM:SS, relative to this segment), who is speaking, a one-line summary of what is said, and a hook-strength rating 1-10. Be strict about self-containment.'
```

Asking for a rating and a one-line summary is what makes the candidates comparable across segments. Add the segment's `-s` offset back to each returned timestamp to get absolute positions in the source, then pick the winner on hook strength and self-containment — not on how interesting the topic is.

## 5. Lock the exact cut points

The analysis gives you seconds; a clip needs the frame. Tighten both ends against the real audio:

- `dapi media transcribe` prints word-level start/end times (use ffmpeg to shorten). Put the in-point on the first word of the hook line and the out-point after the last word of the button.
- `dapi media waveform podcast.m4a -s <in> -e <out>` shows the breaths around those words, so you can open the in-point a beat early and let the out-point land on the silence after the line instead of clipping its tail.

## 6. Download the segment and lay it out

Now fetch the video, and **download with padding** — a few seconds either side of the locked range — so the trim can still be nudged without downloading again.

`dapi media probe clip-raw.mp4` gives the source dimensions (a podcast is almost always 1920×1080) and confirms where the padded range actually starts, since a keyframe-aligned download can begin slightly early.

Give the node the **source's own aspect ratio**, scaled to the scene height, rather than the scene's box: the node is then wider than the scene, and the scene crops it. That geometry is what makes the framing in the next step possible.

```tsx
const raw = "/Downloads/clip-raw.mp4";

// Locked range, expressed in the padded download's own time.
const IN = 6.4;   // first word of the hook
const OUT = 36.1; // after the button lands

const SCENE_W = 1080;
const NODE_H = 1920;
const NODE_W = NODE_H * (1920 / 1080); // source aspect, scaled to scene height ≈ 3413

export default function Project() {
  return (
    <stage camera={[0.25, 0, 0, 0.25, 235, 70]}>
      <scene name="Podcast clip" width={SCENE_W} height={1920} fill="black" active>
        <sequence name="A-roll">
          <video src={raw} width={NODE_W} height={NODE_H} x={(SCENE_W - NODE_W) / 2}
            start={0} sourceIn={IN} sourceOut={OUT} />
        </sequence>
      </scene>
    </stage>
  );
}
```

Save the file and get the trim right before framing or captions — `dapi capture <sceneId> -t 0` on the in-point and the out-point is the check.

## 7. Frame the active speaker (optional if necessary)


```tsx
import { useTicker } from "@diffusionstudio/jsx";

const turns = [
  { at: 0,    fx: 0.30 },
  { at: 8.2,  fx: 0.70 },
  { at: 24.5, fx: 0.30 },
];

const { time } = useTicker();
// time() is the scene playhead; the clip starts at 0, so it is already node-local.
const speakerX = () =>
  centerOn((turns.findLast((s) => time() >= s.at) ?? turns[0]).fx);

// ...
<video src={raw} width={NODE_W} height={NODE_H}
  start={0} sourceIn={IN} sourceOut={OUT} x={speakerX()} />
```


## 8. Captions

Add captions last, after the trim and framing are verified. Use the **`classic`** preset centred — it is the first choice for vertical content.

```tsx
<captions preset="classic" verticalAlign="center" />
```

If the caption block lands on the speakers' faces, push it off with `offsetY` rather than changing the framing you just verified:

```tsx
<captions preset="classic" verticalAlign="center" offsetY={420} />
```

Capture a frame per caption line with `dapi capture` and check readability at delivery size — a caption over a mouth is worse than no caption.
