# Audio sync

`syncTo` places a node in time by listening instead of arithmetic: the node's audio is cross-correlated against another node's audio, and its `start` is computed so the two recordings coincide on the timeline. It replaces manual offset measurement for multi-recorder material: a lav or voice track against camera audio, two cameras on the same take, two microphones in one room.

```tsx
<scene name="Talk" width={1920} height={1080}>
  <video id="camera" src="a-roll/take-3.mp4" width={1920} height={1080} sourceOut={45} muted />
  <audio src="a-roll/lav.wav" syncTo="camera" />
</scene>
```

## Semantics

- `syncTo` names the [`id`](./module.md#ids) of another element in the same render. Both sides must carry an audio track; any pairing works (audio-to-video, audio-to-audio, video-to-video).
- The computed placement is `start = target.start + offset`, where `offset` is the measured source-time offset between the two recordings (positive when this node's recording started after the target's; possibly negative). `syncTo` and `start` are mutually exclusive.
- `sourceIn`/`sourceOut` keep their normal meaning and remain yours to set. When omitted on a synced node, the window defaults to the intersection of the node's natural extent with the target's window (instead of the usual natural-duration fit), so a lav track simply covers its take.
- Alignment reads source content: `muted` and `volume` on either side do not affect the measurement. Use `muted` to keep only one side audible, as on the camera track above.
- Chains resolve in dependency order (A may sync to B while B syncs to C). An unknown id or a cycle is reported on the element like a failed source (see [errors.md](./errors.md)), and the node keeps its default placement.

## Execution

Alignment runs at the resolve stage of the [pipeline](./README.md#pipeline), after both sides' assets have landed (either side may be generated) and before captions read the scene. It is local and consumes no credits. A correlation too weak to trust is reported rather than guessed at (see [errors.md](./errors.md)), and the node keeps its default placement. Offsets are **cached** by the pair of source contents, so re-mounting an unchanged project re-measures nothing.
