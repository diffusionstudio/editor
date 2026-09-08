# JSX Code Syntax

A project is a folder of JSX, and **that source is the document**. The entry file default-exports a **Solid component**; the app compiles it and a custom renderer (built on `solid-js/universal`, Solid's equivalent of React's reconciler) mounts it **directly into the editor's ECS**. Every composition element becomes an entity; every prop is a component write. There is no hidden DOM, no CSS resolution, and no measuring pass.

It goes back the other way too: every element carries an `id`, so a rect dragged on the canvas, a clip trimmed on the timeline or a retyped line lands as a prop on the element it was authored as. Saving recompiles and remounts the project — the way reloading a page rebuilds it — and a compile error leaves the last good render on the canvas.

A project is structured like a SolidJS app: the root is a [`<stage>`](./stage.md) holding one [`<scene>`](./scene.md) per frame you cut in, and the component tree renders into it. **All positioning is explicit** (`x`, `y`, `width`, `height` in pixels).

The markup is **pseudo-SVG**: elements like `<rect>`, `<text>`, `<linearGradientPaint>`, and `<colorStop>` mirror SVG's shape-and-paint model, but the tags and props are the editor's own (see [elements.md](./elements.md)), not the SVG spec.

```tsx
export default function Project() {
  return (
    <stage background="#161616" camera={[0.3, 0, 0, 0.3, 85, 150]}>
      <scene name="Intro" width={1920} height={1080} fill="black" active>
        <video src="b-roll/drone.mp4" start={0} end={6} width={1920} height={1080} />
        <text y={860} width={1920} textAlign="center" fontFamily="Inter" fontSize={96} start={1} end={5}>
          Hello
          <animation type="fade" duration={0.5} />
          <animation type="fade" phase="out" duration={0.5} />
        </text>
      </scene>
    </stage>
  );
}
```

## Contents

| File | Covers |
| ---- | ------ |
| [module.md](./module.md) | Project module contract, module environment, `id`, types and tooling |
| [stage.md](./stage.md) | `<stage>`: the root, canvas background and camera, canvas placement |
| [scene.md](./scene.md) | `<scene>`: the clipped, playable frame and the timeline its children sit on |
| [elements.md](./elements.md) | Element-to-node mapping, coordinates and sizing, the shared property table |
| [group.md](./group.md), [rect.md](./rect.md), [text.md](./text.md), [video.md](./video.md), [image.md](./image.md), [audio.md](./audio.md) | Per-element props |
| [fonts.md](./fonts.md) | Fonts for `<text>` and HTML: local families, `dapi fonts` |
| [paints.md](./paints.md) | `<solidPaint>`, gradients, `<colorStop>`, `<imagePaint>` / `<videoPaint>` |
| [styles.md](./styles.md) | `<stroke>`, `<shadow>`, `<effect>`: outlines, drop shadows and filters |
| [html.md](./html.md) | `<html>`: reactive HTML children drawn into the box |
| [surface-paint.md](./surface-paint.md) | `<surface>`: a ref-provided canvas you draw into, sampled every frame |
| [shader-paint.md](./shader-paint.md) | `<shaderPaint>`: a WGSL fragment shader over the media paint below it |
| [media.md](./media.md) | `src` resolution (paths, URLs, asset ids, `AssetRef`), image sequences, modifiers, adding an asset to the library |
| [timing.md](./timing.md) | `start` / `end` / `sourceIn` / `sourceOut` / `playbackRate`, time formats |
| [keyframes.md](./keyframes.md) | Keyframe animation and easing |
| [animations.md](./animations.md) | `<animation>`: preset in/out animations |
| [transitions.md](./transitions.md) | The `transition` prop on sequence clips |
| [sequences.md](./sequences.md) | `<sequence>` sequential placement |
| [adjustment-layer.md](./adjustment-layer.md) | `<adjustmentLayer>`: a transform over the clip below it |
| [audio-sync.md](./audio-sync.md) | `syncTo` audio alignment |
| [captions.md](./captions.md) | `<captions>` and style presets |
| [generate.md](./generate.md) | Declarative AI asset generation (`generate.*`) |
| [variables.md](./variables.md) | `@inspect` variables: annotated consts as live inspector controls (number, color, text, font, boolean, select) |
| [lifecycle.md](./lifecycle.md) | Mount lifecycle: always live, persisted + re-executed, `useTicker`, `useResolution` |
| [errors.md](./errors.md) | Where each pipeline stage fails and with what effect |

## Pipeline

Everything below runs in the app, on open and again on every save of a project file.

1. **Stamp**: every composition element that has no `id` is given one, written back into your source. Ids are what an entity is traced to, so they are minted before the file is numbered rather than after (see [module.md](./module.md#ids)). A project where nothing is missing an id is not written to.
2. **Compile**: the entry file bundles with esbuild + `babel-preset-solid` in `universal` mode, so JSX compiles against the editor's renderer runtime instead of the DOM. `solid-js`, `solid-js/store` and `@diffusionstudio/jsx` are external — the app supplies its own instances; everything else is bundled. A compile error is reported and the canvas keeps the last good render.
3. **Evaluate**: the app imports the module. Top-level code runs to completion. The module's **default export** is the project component.
4. **Mount**: the component tree renders **directly into the world**. There is no staging tree: each element materializes as an entity as it is created, and the root `<stage>` is the one already there. Mounting is synchronous, and a throw part-way through leaves nothing behind — the document is disposed and the previous render stays on the canvas.
5. **Resolve**: every `src` resolves in the background — a path or asset id is loaded, a `generate.*` declaration is generated in dependency order, a `<captions>` without a `src` transcribes its scene. Each element renders a generating state until its asset lands, and an element that fails carries the reason (see [generate.md](./generate.md), [errors.md](./errors.md)). Non-blocking: the composition is on the canvas and editable while this runs, and [`dapi context`](../context.md) reports where each generation stands.
6. **Live**: the reactive graph keeps running for as long as the project is open — signals, effects, `useTicker` (see [lifecycle.md](./lifecycle.md)). Export, capture and the next open re-execute the same module.

A save replaces the whole run: the old mount is disposed and the new one takes the stage. Scenes are rebuilt rather than accumulated, and the entities the previous render owned go with it.
