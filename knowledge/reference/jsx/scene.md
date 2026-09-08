# `<scene>`

A scene is the **clipped, playable frame** a composition is made in, and the only element allowed directly under [`<stage>`](./stage.md). It clips its children to `width`×`height` and **owns the timeline they are placed on**, so it takes no timing of its own — nothing outside a scene has a clock to be placed against.

```tsx
<scene name="Intro" width={1920} height={1080} fill="black" active>
  {/* children, placed on this scene's timeline */}
</scene>
```

## Props

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `width`, `height` | `number` | **required** | Composition size in pixels — the frame that is rendered and exported. Required by the type; a scene that somehow reaches the runtime without them is 1920×1080. |
| `keepAspectRatio` | `boolean` | absent | Locks the frame to its authored proportions: resizing one bound in the editor drives the other. |
| `x`, `y` | `number` | `0` | Where the frame sits on the infinite canvas. Scenes without one all sit at the origin. |
| `fill` | `string` | none | Background fill, any CSS color; alpha is ignored. A scene without one is transparent, and exports with alpha. |
| `name` | `string` | none | Human-readable node name; what labels the scene in the editor. Recommended. |
| `volume` | `number` | `0` | Decibels on the scene's own bus, which everything in it mixes into — the master fader. `0` = unity, negative attenuates (`-6` ≈ half as loud), `-Infinity` = silence. A clip's own `volume` composes with this one. |
| `active` | `boolean` | absent | Whether this is the scene the playhead, the timeline and `dapi capture` operate on. |
| `workarea` | `[in, out] \| null` | `null` | The stretch of the scene that plays and exports, in any [time format](./timing.md#time-formats). |
| `selected` | `boolean` | absent | Whether the editor has the scene selected. |
| `timeline` | `[zoom, x, y]` | absent | Where the scene's timeline is looking: `zoom` in pixels per second of timeline, horizontal scroll in seconds, vertical scroll in pixels. Absent means the default zoom, at the beginning. |

A scene also takes paints as children, exactly as a `<rect>` does (see [paints.md](./paints.md)); `fill` is the shorthand for a solid one.

## Editor state in the source

`active`, `selected`, `x`, `y` and `timeline` are editor concerns rather than part of the composition, but they live in the file for the same reason [`<stage>`](./stage.md)'s `camera` does: the source is the document, so a scene dragged or clicked on the canvas — or a timeline scrolled or zoomed — has nowhere else to be written back to. The editor writes them and removes them again; there is no need to author a `timeline`, and the first scroll or zoom overwrites one.

Two rules the runtime holds for `active`: **at most one element is active**, and **only a root** — a direct child of `<stage>` — can be. A nested `active` is dropped, and when a file names more than one the last one rendered wins.

**Mark one scene `active` in every project you author.** Nothing activates on its own, and a project that opens with no active scene opens on an empty timeline: there is no playhead to scrub, `dapi capture` has nothing pointed at it, and an export has no scene to render. One scene, one `active`; with several, the one the project should open on — pair it with the [`<stage>`](./stage.md) `camera` that frames it.

`workarea` is the exception among them: it is carried by the source the way `active` is (the timeline's brackets have nowhere else to go), but it is read wherever the file is, so **what it says is what comes out of a render**. Playback loops within it, and an export is of it and nothing else.

```tsx
// Renders seconds 2–8 of the scene, and nothing else.
<scene name="Cut" width={1920} height={1080} workarea={[2, 8]}>{/* ... */}</scene>
```

## Constraints

- **Only under `<stage>`.** Scenes do not nest. Other elements may sit at root level beside them (see [stage.md](./stage.md)), but only a scene has a timeline, and only a scene renders.
- **No timing props.** A scene is the clock its children are placed against; it spans whatever they span.
