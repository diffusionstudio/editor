# `<group>`

A container with a transform but no box of its own: a group derives its bounds from its children, and they are positioned relative to it.

```tsx
<group x={100} y={100}>
  {/* children */}
</group>
```

## Props

A group takes the [common](./elements.md#common-props) **transform** (`x`, `y`, `offsetX`, `offsetY`, `rotation`, `scale`, `scaleX`, `scaleY`, `opacity`), **composite** (`blendMode`, `hidden`) and **timing** (`start`, `end`) props.

It has **no `fill`, no `width` and no `height`**, and takes no [paint children](./paints.md): its box is the union of its children's. `<effect>`, `<animation>` and `<keyframeTrack>` children are valid — an effect on a group filters the group as a whole.

## Timing

A group with no `end` of its own **spans its children**: it begins where the earliest one begins and ends where the last one ends, and follows them as they move. Give it an `end` and it trims them instead — children outside the window do not play. See [timing.md](./timing.md).

An empty group, having nothing to span, falls back to the 16-second default.

## Grouping and ungrouping

Groups are what the editor's group action creates and what its ungroup action takes apart, so a group written by hand and one made on the canvas are the same element. A [`<sequence>`](./sequences.md) is a group with the non-overlap invariant added and its own transform taken away.
