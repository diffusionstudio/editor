# Transitions

`transition` declares a transition **into the next clip**, set on the **outgoing** clip and rendered centered on the cut. It is valid only on direct children of [`<sequence>`](./sequences.md).

```tsx
<sequence>
  <video src="/Movies/intro.mp4" width={1920} height={1080} start={0} end={12} transition={{ type: "fadeToBlack", duration: "20f" }} />
  <video src="/Movies/main.mp4" width={1920} height={1080} start={12} end={24} transition={{}} />  {/* dissolve, 1s */}
  <video src="/Movies/outro.mp4" width={1920} height={1080} start={24} end={30} />
</sequence>
```

```ts
type TransitionSpec = {
  type?:     TransitionType;   // default "dissolve"
  duration?: Time;             // length, centered on the cut; default 1 second
};
```

## Types

The editor's transition inspector options:

| `type` | Effect |
| ------ | ------ |
| `"dissolve"` (default) | Crossfade between the two clips. |
| `"slideFromRight"` | The next clip slides in from the right. |
| `"slideFromLeft"` | The next clip slides in from the left. |
| `"fadeToBlack"` | Fade out to black, then in to the next clip. |
| `"fadeToWhite"` | Fade out to white, then in to the next clip. |

## Semantics

- `duration` takes any [time format](./timing.md#time-formats) and is centered on the cut: half plays before it, half after.
- A **partial value merges** into the clip's existing transition: `transition={{ duration: 2 }}` keeps the current type; `transition={{}}` applies the defaults.
- **`null` removes** the clip's transition.
- A transition is not an element of its own: it is a prop of the outgoing clip, so it moves, trims and copies with it.
