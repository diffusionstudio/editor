# Project module

A project is a folder: a real npm package whose entry file (`package.json` `main`, `index.tsx` by default) default-exports a Solid component rendering a [`<stage>`](./stage.md).

```tsx
export default function Project() {
  return (
    <stage background="#161616" camera={[0.3, 0, 0, 0.3, 85, 150]}>
      <scene name="Intro" width={1920} height={1080} fill="black" active>
        {/* ... */}
      </scene>
    </stage>
  );
}
```

The component receives no props. [`dapi open <dir>`](../open.md) opens the folder — creating it, and an `index.tsx` holding an empty stage, if it is not a project yet.

## The folder

`open` writes as little as it takes to make a folder a project, and the rest of the scaffold appears lazily. What ends up there:

| Path | What it is |
| ---- | ---------- |
| `index.tsx` | The entry. Its default export renders the composition. |
| `package.json` | The project record: `projectId` (its identity, kept across renames), `displayName`, `main`, and the dapi commands as scripts. |
| `tsconfig.json` | Types for the composition tags, through `jsxImportSource`. |
| `assets.yml` | The asset library (see [media.md](./media.md#the-library)). |
| `assets/` | The library's files: symlinks to media brought in from elsewhere, plus what the app produced itself, generations under `assets/generated/`. Media imported through the app is linked where it lies, never copied. |
| `cache/` | Derived data (thumbnails, waveforms). Disposable. |
| `AGENTS.md` | The agent entry point: how to connect to the app, whose MCP server carries this reference, and how to work here. |

Everything is written once and is yours from then on. The reference itself is not copied into the project: the app serves the installed version's as MCP resources under `dapi://docs/`.

## Ids

Every composition element carries an `id`, and the app stamps one onto every element that lacks it before each compile — written back into your source, six base-36 characters, unique within its file:

```tsx
<rect id="k3f9x1" x={40} y={40} width={640} height={360} fill="#FF0055" />
```

An id is what makes an element addressable: it is how an entity is traced back to the JSX that produced it, so a change made on the canvas can be written to the element it came from, and it is what [`dapi capture`](../capture.md) takes to render one node. It is also how elements point at each other within a render — [`syncTo`](./audio-sync.md) names the id of the clip it aligns against.

**Ids are yours to write.** Any string is valid, and `id="hero"` is worth more to read than anything minted. The stamp only fills in elements that have none, so renaming one by hand is safe. Ids are stripped at compile time and never reach the runtime as a prop; what survives is the stamp that carries them.

## Module environment

Imports resolve by category:

- **Host modules** (marked external at compile time, resolved in-app so the project shares the editor's reactive runtime): `solid-js`, `solid-js/store`, `@diffusionstudio/jsx`. These must be the editor's own instance and never come from anywhere else — a project's own `node_modules` copy is types only.
- **Userland packages** — any other bare specifier (`three`, `gsap`, `d3-scale`, …). A project folder is a real npm package, so these work as they normally do: install one (`npm i three`) and esbuild resolves it from the project's `node_modules` and bundles it into the compiled module, subpath imports and `exports` maps included. Nothing is installed for you and there is no CDN fallback — a specifier that does not resolve fails the compile with `Could not resolve "three"`, and the canvas keeps the last good render. Libraries must be browser-compatible (no Node builtins); sources under `node_modules` skip the JSX transform, so a package must ship compiled JavaScript rather than raw JSX.
- **Local imports**: relative/absolute paths (`./helper`, local JSON) are resolved on disk and bundled. Static `https://…` imports are **not** supported — they survive bundling as a require the renderer cannot satisfy, and fail at mount.
- The module executes **inside the editor process**, unsandboxed. This is local tooling with a local trust model, the same trust as running the app itself. Only effects made through the JSX runtime are part of the document; anything else the module does is unsupported.
- Solid's control flow (`<For>`, `<Show>`, `<Index>`, `<Switch>`) and primitives (`createSignal`, `createMemo`, …) are fully available. Control-flow components need their import (`import { For } from "solid-js"`); the compile says so by name when one is missing. See [lifecycle.md](./lifecycle.md) for what happens after mount.

## Compile-time plugins (babel config)

Some libraries ship a compile step of their own — [TypeGPU](https://typegpu.com)'s `'use gpu'` functions, for example, only work after its build plugin has run. A project may carry a standard babel config at its root (`babel.config.json`, `babel.config.js`, or `.babelrc`) for exactly this, and the compile folds its **plugins** into the pipeline:

```json
{ "plugins": ["unplugin-typegpu/babel"] }
```

Plugin names resolve from the project's own `node_modules`, so the library and its plugin are installed like any userland package (`npm i typegpu && npm i -D unplugin-typegpu`). The plugins run after the editor's own passes (id stamping, tag canonicalization) and before the JSX transform, so a plugin that rewrites JSX still feeds the compile — though elements it synthesizes carry no id and canvas edits to them cannot be written back.

Only `plugins` is honored. `presets` would fight the fixed transform stack and are ignored with a console warning; other options (`sourceMaps`, `targets`, …) shape output the compiler owns and are ignored silently. A config that fails to evaluate — or names a plugin that is not installed — fails the compile with the reason. The config is read once per compile against the entry file, so per-file `overrides` apply project-wide. Prefer `babel.config.json`: edits to it apply on the next compile, while a `babel.config.js` is cached for the app's lifetime and needs a restart to pick up changes.

[examples/10-typegpu.tsx](../../examples/10-typegpu.tsx) is a full project using this: TypeGPU shaders written in TypeScript, compiled through the project's babel config.

## Tag spelling

Composition elements are **camelCase** intrinsics (`<rect>`, `<keyframeTrack>`, `<linearGradientPaint>`); the compile canonicalizes them to the components the renderer receives. Writing one PascalCase (`<Rect>`) is a compile error naming the tag you meant.

Lowercase DOM tags are the vocabulary for [`<html>`](./html.md) content. Three names belong to both vocabularies — `rect`, `text`, `image` — and resolve lexically: inside an SVG container (`<svg>`, `<g>`, `<defs>`, …) they are SVG content, everywhere else composition elements.

## Types and tooling

`@diffusionstudio/jsx` ships the JSX namespace (which types the camelCase composition tags), for editor IntelliSense and typechecking in a project folder:

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@diffusionstudio/jsx"
  }
}
```

The compile does not typecheck; types are stripped. Run `npx tsc --noEmit` in the project folder for type safety.

Installing a userland package gives it both its runtime code and its types. A package that ships no declarations of its own needs its `@types/…` alongside it (`npm i -D @types/three`). `@diffusionstudio/jsx` and `solid-js` are the exception: they are declared in the scaffolded `package.json` for types only, since the compiler always keeps them external and the running composition uses the app's own instance.
