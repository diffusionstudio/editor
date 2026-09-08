# Example: long-form talking head

A single speaker to camera — an explainer, a podcast solo, a course lesson. The recording is long and raw: restarts, flubbed lines, and dead air between thoughts. The edit cuts it down to the clean story, back-to-back, never mid-word. The transcript drives the A-roll; the waveform separates silence from performance.

## 1. Brief

Write the brief first. It records the source files, the target duration (or "keep everything good"), and any editorial instruction. Absent a target length or explicit direction, **make no editorial cuts**: keep every good part, drop only silences and double takes, and keep the story chronological.

## 2. Analysis

The transcript is the spine, so transcribe everything with speech.

- **Transcribe every video and any external audio.** `dapi media transcribe <id|path>` prints word-level start/end times — the times you cut on. Run it on each camera take and on any separate recording (a lav or interface track you will sync to).
- **Render the waveform to read the gaps.** `dapi media waveform <id|path>` marks silence in red and returns it as second ranges. A transcript marks only speech, so a gap in it can be silence *or* something to keep — a laugh, a breath. The waveform tells them apart: red is dead air to cut; a gap that still shows signal is performance to keep.
- **Resolve double takes visually.** The transcript shows repeated lines; usually the **last** take is the keeper. When takes read equally well, `dapi media grab -t` the first word of each and keep the sharpest — motion blur means a bad take.

## 3. Lay out the A-roll

Drop **every** double take and silence, and put the good parts in chronological order.

```tsx
import { For } from "solid-js";

const raw = "/Recordings/take.mp4";

// Kept stretches, in order — source range only.
const takes = [
  { src: raw, sourceIn: 48.2, sourceOut: 53.9 },  // opener — third take, sourceIn on the first word
  { src: raw, sourceIn: 61.7, sourceOut: 69.4 },  // next sentence — sourceIn opens ~0.4 s early for a breath
  { src: raw, sourceIn: 74.0, sourceOut: 78.1 },  // mid-sentence pickup — flubbed clause dropped
  { src: raw, sourceIn: 95.2, sourceOut: 102.8 }, // closer — trailing air left in sourceOut
];

// Chain them back-to-back: each start is the sum of the durations before it.
let cursor = 0;
const aRoll = takes.map((t) => {
  const start = cursor;
  cursor += t.sourceOut - t.sourceIn;
  return { ...t, start };
});

export default function Project() {
  return (
    <stage camera={[0.25, 0, 0, 0.25, 235, 70]}>
      <scene name="Talking head" width={1080} height={1920} fill="black" active>
        <sequence name="A-roll">
          <For each={aRoll}>
            {(clip) => (
              <video src={clip.src} width={1080} height={1920}
                start={clip.start} sourceIn={clip.sourceIn} sourceOut={clip.sourceOut} />
            )}
          </For>
        </sequence>
      </scene>
    </stage>
  );
}
```

The silence you *keep* between sentences lives inside the clips, not in a timeline gap — a gap in a sequence freezes or blanks the frame. Carry a pause by extending a clip's `sourceOut` (or opening the next `sourceIn`) into the real silence, and keep the timeline gapless.

Save the file — the app recompiles and re-renders it — and get the spine right before layering anything on top.

## 4. Cut points

- **Open tight.** Set the first `sourceIn` on the first word — dead air at the top kills retention.
- **Between sentences, leave 0.3–0.5 s of silence.** Enough to breathe, not to drag. Tune it with each clip's `sourceOut` / next `sourceIn`.
- **Mid-sentence, butt the words together.** When you drop a clause inside a sentence, close the gap as far as it goes — never mid-word. Grab the frames around the join to confirm the word is whole.
- **End on up to 0.8 s.** Leave a little trailing air in the last `sourceOut` so the video doesn't stop abruptly.

## 5. Verification

Run `dapi check <sceneId>` first: on a long timeline of many clips, a `sourceOut`/`start` that don't meet leaves a gap no sampled frame would land on, and the check names those spans outright.

Then the cut points, which matter most. Capture the **first frame of every clip** with `dapi capture <sceneId> -t ...` at each clip's `start`, and check the cut didn't land on a bad frame — motion blur is the usual tell; nudge `sourceIn` a few frames to a settled one. Reconcile against the brief, and re-check neighbouring cuts after any structural change.

## 6. Visual hook (optional)

A hook makes the video readable at a glance. Aim for a frame you could lift out and use as a thumbnail.

- **Just a title.** One line of large Inter at medium weight, in a single colour. That is the whole hook: **no sub-header, eyebrow, or secondary line**, and **no background, box, panel, or fill** — the text sits directly on the A-roll.
- **Placement.** Beside the speaker's head or below it, **never covering the head**. A popular strategy is to place it A-roll aware.
- **Duration.** Keep it on screen as long as the viewer needs to read it.

One line of copy is a job for the native `<text>` tag:

```tsx
<text
  x={80} y={1240} width={920} height={260}
  start={0} end={3}
  fontFamily="Inter" fontSize={84} fontWeight={500} color="#fff"
  textAlign="left" textBaseline="top"
>
  The one editing trick
</text>
```

## 7. Captions (optional)

Add captions **last**, after every cut and overlay is verified, so they transcribe the final audio at its final placement. Use the **`whisper`** preset aligned to the bottom, and start it where the hook ends — set both `start` and `sourceIn` to that timestamp so the transcript stays aligned (see `reference/jsx/captions.md` in the project's docs). Keep captions off overlays and off the important part of the A-roll.

```tsx
{/* Hook holds until 00:03; captions begin there. */}
<captions preset="whisper" verticalAlign="bottom" start={3} sourceIn={3} />
```
