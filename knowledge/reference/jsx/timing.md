# Timing

Timing splits the two independent questions a clip answers: **where it sits on the parent timeline** (`start` / `end`) and **which part of its source plays** (`sourceIn` / `sourceOut`). All values accept any [time format](#time-formats).

| Prop | Meaning |
| ---- | ------- |
| `start` | Parent-timeline time at which the clip begins. Default 0. |
| `end` | Parent-timeline time at which the clip ends. Alternative to `sourceOut`. |
| `sourceIn` | Source in point: the time within the source where playback begins. Default 0; trims the head. |
| `sourceOut` | Source out point: the time within the source where playback ends. Defaults to the source's natural end. Alternative to `end`. |
| `playbackRate` | Speed multiplier for the node's local time, 1 = normal. See [below](#playback-rate). |

Times are **parent-relative**: a clip inside a [`<group>`](./group.md) or a [`<sequence>`](./sequences.md) is placed against that container's start, and a clip directly in a [`<scene>`](./scene.md) against the scene's timeline. Nothing outside a scene has a clock to be placed against.

## Semantics

- `start` / `end` place the clip on the parent timeline. `sourceIn` / `sourceOut` select which part of the source plays. The trimmed window opens at `start`, so at rate 1 the on-timeline duration equals the played source length: `end - start == sourceOut - sourceIn`.
- **Trimming the source is not the same as moving the clip.** To drop part of the source you must move `sourceIn` / `sourceOut`; changing `start` alone only slides the clip along the timeline while the full source keeps playing. If the source is meant to stay aligned with something else in the scene (synced audio, a transcript, another track), advance `start` and `sourceIn` **together** — moving one without the other offsets the content instead of trimming it.
- **`end` and `sourceOut` are two spellings of the same out edge** — the clip's end in timeline time (`end`) versus source time (`sourceOut`). Set one. Set both and **the one that closes first wins**: each is a cap on the window rather than an override of the other, so a clip never runs past either.
- A source is a cap of its own: a trim past the end of the footage runs out of frames rather than holding.
- Sourceless nodes (`<rect>`, `<text>`, `<html>`, `<surface>`, `<adjustmentLayer>`) have no footage to trim, so you place them with `start` / `end` alone.
- Instead of setting `start`, a media node can derive its placement from another node's audio with `syncTo` (see [audio-sync.md](./audio-sync.md)).
- **Containers span their children.** A `<group>` or a `<sequence>` with no `end` of its own begins where its earliest child begins and ends where its last one ends, and follows them as they move. Give it an `end` and it trims them instead.
- **A media node with no timing fits its natural duration** at `start` 0.
- **A sourceless node with no `end` gets a fixed 16-second duration** — as does a still image, which has no duration of its own, and an empty container, which has nothing to span.
- A [`<sequence>`](./sequences.md) does not position its children for you: give each an explicit `start` (the next clip's `start` is the previous clip's end).

> Examples:
> - `<rect start={2} end={5} width={200} height={120} fill="red" />` — a rectangle on screen from timeline second 2 to 5.
> - `<video start={5} sourceIn={10} sourceOut={20} />` — plays source seconds 10–20 (a 10-second clip) beginning at timeline second 5.
> - `<video start={2} end={5} sourceIn={10} />` — the same source starting at 10 s, over the timeline window 2–5 (so it plays source 10–13).
> - `<video start={0} sourceIn={1} />` — trims the first second off the head and places the clip at the top of the timeline.

## Playback rate

`playbackRate` scales the node's local time against its parent's: at `2`, twice as much source plays in the same stretch of timeline; at `0.5`, half. Default `1`.

It scales the window rather than replacing it, so the two spellings keep their meanings and stay consistent with each other:

```tsx
// 10 seconds of source (2–12) over 5 seconds of timeline (0–5).
<video src="b-roll/drone.mp4" start={0} sourceIn={2} sourceOut={12} playbackRate={2} />

// The same thing from the other side: the timeline window and the rate imply the out point.
<video src="b-roll/drone.mp4" start={0} end={5} sourceIn={2} playbackRate={2} />
```

Audio is retimed with the picture. Everything the node holds — its children, its keyframes, its animations — runs on the node's local clock and is retimed with it.

## Time formats

```ts
type Time = number | `${number}f` | `${string}:${string}`;
```

The canonical internal unit is frames at **30 fps**; all formats are converted on import. All values may be negative.

| Format | Example | Meaning |
| ------ | ------- | ------- |
| `number` | `2.2` | Seconds (may be fractional). |
| `"${number}f"` | `"-30f"` | Frames. |
| `"MM:SS"` | `"02:30"` | Minutes and seconds. |
| `"HH:MM:SS"` | `"01:02:30"` | Hours, minutes, seconds. |

CLI flags documented as taking a `Time` value (e.g. `--time` on [`capture`](../capture.md) and [`media grab`](../media/grab.md)) accept the same formats. Times in command **output** are plain seconds.
