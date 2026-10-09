# `<path>`

A vector outline from SVG path data: any number of subpaths, open or closed, of straight and curved segments. Takes the same children as [`<rect>`](./rect.md): [paint children](./paints.md), plus [`<stroke>`, `<shadow>`, `<effect>`](./styles.md), [`<animation>`](./animations.md) and [`<keyframeTrack>`](./keyframes.md).

```tsx
<path x={420} y={180} width={320} height={240} fill="#FF0055"
      d="M0 240 C80 0 240 0 320 240 Z">
  <stroke color="#000000" width={6} join="round" cap="round" />
</path>
```

## Props

All [common props](./elements.md#common-props), plus:

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `d` | `string` | none | SVG path data. Every command is read, absolute and relative: `M` `L` `H` `V` `C` `S` `Q` `T` `A` `Z`. Without it the path draws nothing. |
| `viewBox` | `string` | `"0 0 width height"` | The rectangle of `d`'s coordinates the box shows, `"x y width height"`, stretched onto the box on each axis. |
| `fillRule` | `"nonzero" \| "evenodd"` | `"nonzero"` | What counts as inside where the outline crosses itself or one subpath sits inside another. `"evenodd"` always cuts a hole; `"nonzero"` only cuts one drawn the other way round from its outline. |
| `trimStart`, `trimEnd` | `number` | `0`, `1` | Draw only the part of each subpath between these two fractions of its length (After Effects' Trim Paths). The part that is left is also what is filled and picked up on the canvas. |
| `trimOffset` | `number` | `0` | Slides the trimmed part along the path, as a fraction of its length. It wraps, so `1` is once round: across the start of a closed subpath, into a second piece on an open one. |
| `fill` | `string` | none | Any CSS color; alpha is ignored (use `opacity`). Shorthand for a solid paint child, drawn beneath any paint children. |
| `clipPath` | `boolean` | `false` | Makes the path a clip path of its parent instead of a drawn shape: the parent shows only inside its outline. Works like [`<rect clipPath>`](./rect.md#clip-paths); a keyframed `d` on one is an animated mask. |

A `d` that does not parse draws what came before the error, as SVG does, and the error is logged. Without `width`/`height` a path's box is 100×100. A fill closes open subpaths with a straight line; a [`<stroke>`](./styles.md#stroke) does not, and ends them with its `cap`.

## Coordinates and the box

`d` is in the box's own pixels, `0 0` at its top-left, unless a `viewBox` says otherwise. With a `viewBox`, `d` is drawn from that rectangle and stretched to fill the box on each axis (SVG's `preserveAspectRatio="none"`), so resizing the box resizes the outline without `d` changing, and a `width`/`height` keyframe stretches the path. Strokes are not stretched: a 6 px stroke stays 6 px wide.

The editor keeps the two in step the way Figma does. Resizing a path's box writes a `viewBox` holding the size the box had, and leaves `d` alone. Editing its vertices on the canvas folds the `viewBox` back into `d` once you are done, and fits the box to the outline again (to every keyframe's outline, for a keyframed path). The box is left as it is while one of its own props (`x`, `y`, `width`, `height`, `rotation`, `scale`) is keyframed.

The editor writes `d` back as absolute `M`/`L`/`C`/`Z`, with coordinates rounded to two decimals: arcs and quadratics come back as the cubic curves they are drawn with.

## Animating the outline

A `d` [keyframe track](./keyframes.md) morphs the outline: each keyframe's `value` is path data, and every anchor and control point moves in a straight line from one keyframe to the next, eased like any other track.

```tsx
<path x={420} y={180} width={320} height={240} fill="#FF0055"
      d="M0 240 C80 0 240 0 320 240 Z">
  <keyframeTrack property="d">
    <keyframe time={0} value="M0 240 C80 0 240 0 320 240 Z" easing="easeInOut" />
    <keyframe time={1} value="M0 120 C80 240 240 240 320 120 Z" />
  </keyframeTrack>
</path>
```

- Vertices pair up in order, each subpath's `M` with the other keyframe's. To change which vertex goes where, start the subpath at a different vertex.
- Subpaths with different numbers of vertices still morph: the one with fewer is subdivided, its longest segments split in half until the counts match.
- A different number of subpaths, or an open subpath against a closed one, does not morph. The outline holds until the next keyframe and then jumps.
- A spring easing that overshoots carries the outline past the keyframe and back.

In the inspector, the diamond in the Path section's header keys the outline at the playhead, which is how a path's animation is started. Click it again on a keyframe to remove that keyframe. When you edit a keyframed path on the canvas, a moved vertex or handle is keyed at the playhead. A vertex added or deleted is added to or deleted from every keyframe, so the keyframes keep matching.

`trimStart`, `trimEnd` and `trimOffset` take keyframe tracks as numbers do. Keying `trimEnd` from `0` to `1` draws a line on:

```tsx
<path width={600} height={200} d="M0 100 C150 0 450 200 600 100">
  <stroke color="#FFFFFF" width={8} cap="round" />
  <keyframeTrack property="trimEnd">
    <keyframe time={0} value={0} easing="easeOut" />
    <keyframe time={1.2} value={1} />
  </keyframeTrack>
</path>
```

## On the canvas

- **Pen (P)** draws a new path one vertex at a time. Click to place a corner; drag to place a smooth vertex and pull out its handles. Click the first vertex to close the path; press Enter or Esc to leave it open. The path lands in the scene its first vertex was placed in, with a stroke and a box fitted to it.
- **Edit (Enter, or double-click a path)** shows the vertices:
  - Drag a vertex, or one of the picked vertex's handles. A smooth vertex's other handle turns with it; hold Alt to move one handle on its own.
  - Double-click a vertex to turn it into a corner or make it smooth.
  - Click on the outline to add a vertex there.
  - Delete or Backspace removes the picked vertex.
  - Enter, Esc or a click away from the path finishes editing.
- A click picks up a path inside what it fills, or within reach of its outline (its widest stroke, plus a few pixels), so open unfilled paths can be picked up too.
