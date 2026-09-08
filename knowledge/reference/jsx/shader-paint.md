# `<shaderPaint>`

A paint that runs a **WGSL fragment shader over the media paint directly below it** in the parent's paint stack. On a `<video>` or `<image>` the media paint created by `src` sits first, so a `<shaderPaint>` child post-processes the frame: the media renders only through the shader's output, letting shaders remap colors, distort, or cut alpha (chroma key). Rendering uses WebGPU; where WebGPU is unavailable the shader is skipped and the media draws unshaded.

Without a media paint directly below, the shader runs **procedurally**: `sampleSource` returns transparent black everywhere and the output is generated purely from `uv`, `globals.time`, and uniforms, stacking over any paints below like a normal paint. That makes `<shaderPaint>` in a `<rect>` a compact alternative to a WebGPU-driven [`<surface>`](./surface-paint.md) for generative fills.

```tsx
const INVERT = /* wgsl */ `
  @fragment
  fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
    let color = sampleSource(uv);
    return vec4f(1.0 - color.rgb, color.a);
  }
`;

<video src="b-roll/clip.mp4" width={1920} height={1080}>
  <shaderPaint wgsl={INVERT} />
</video>
```

```tsx
<rect width={960} height={540}>
  <shaderPaint wgsl={/* wgsl */ `
    @fragment
    fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
      let rgb = 0.5 + 0.5 * cos(globals.time + uv.xyx * 4.0 + vec3f(0.0, 2.0, 4.0));
      return vec4f(rgb, 1.0);
    }
  `} />
</rect>
```

Before the pipeline has compiled a `<shaderPaint>` draws nothing and the stack renders as if it were absent. A media paint below it whose frame has not decoded yet also keeps the shader silent, so the media's own loading state stays visible.

## The shader contract

You write only the fragment stage; the engine owns the vertex stage and prepends a prelude. The entry point is:

```wgsl
@fragment
fn main(@location(0) uv: vec2f) -> @location(0) vec4f
```

`uv` spans the parent's box, `(0,0)` top-left to `(1,1)` bottom-right. The output is premultiplied-alpha and clips to the parent's box (including `cornerRadius`), like every paint. The prelude provides:

| Binding | Meaning |
| ------- | ------- |
| `sampleSource(uv: vec2f) -> vec4f` | Samples the media in box space, honoring its `objectFit` placement; letterbox areas return transparent black. Premultiplied. |
| `source: texture_2d<f32>`, `sourceSampler: sampler` | The raw frame texture, for sampling outside the fit mapping. |
| `globals.time: f32` | The parent element's local time in seconds. Playhead-driven, so scrubbing and exports are frame-accurate. |
| `globals.resolution: vec2f` | The parent's box size in composition pixels. |
| `globals.fitOffset`, `globals.fitSize: vec2f` | The media's `objectFit` placement within the box, normalized (what `sampleSource` applies). |

## Uniforms

Parameters are declared as individual `@group(1)` uniforms and their values arrive through the `uniforms` prop, **matched by declaration name**:

```tsx
const TINT = /* wgsl */ `
  @group(1) @binding(0) var<uniform> strength: f32;
  @group(1) @binding(1) var<uniform> tint: vec3f;

  @fragment
  fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
    let color = sampleSource(uv);
    return vec4f(mix(color.rgb, tint * color.a, strength), color.a);
  }
`;

<shaderPaint wgsl={TINT} uniforms={{ strength: 0.5, tint: "#FF0055" }} />
```

Value mapping: a `number` binds to `f32`, an array of 2-4 numbers to `vec2f`/`vec3f`/`vec4f`, a CSS color string to `vec3f` (rgb, 0-1) or `vec4f` (alpha 1). Supported uniform types are the `f32` family only. Undeclared keys are ignored; declared uniforms without a value read as zeros.

## Props

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `wgsl` | `string` | **required** | Fragment-stage WGSL source (entry point `main`). |
| `uniforms` | `Record<string, number \| number[] \| string>` | `{}` | Values for the shader's `@group(1)` uniforms, by name. |
| `opacity` | `number` | `1` | Paint opacity, `0`–`1`. |

Like all paints it stacks with siblings in document order; `<shaderPaint>` takes no children.

## Changing a shader live

Shader paints are live entities, and a project stays mounted, so a `uniforms` value driven by a signal is a hot update — no recompile, no reload:

```tsx
const [strength, setStrength] = createSignal(0.5);

<shaderPaint wgsl={TINT} uniforms={{ strength: strength(), tint: "#FF0055" }} />
```

Swapping `wgsl` recompiles the pipeline asynchronously; the media shows unshaded until the new one lands. Editing the file itself remounts the project, which is the same thing at a coarser grain.

## Errors and limitations

- WGSL compile errors are reported on the app console ([`dapi logs`](../logs.md)) with line numbers relative to your source; the paint renders as passthrough until a fix lands.
- Pipeline compilation is asynchronous. Live playback may show the first frames unshaded; exports wait for compilation, so rendered output is always shaded.
- One shader reads one media paint; shaders do not chain and do not read solid/gradient/html/surface paints or the composited stack (over those the shader runs procedurally and stacks on top).
- For full custom pipelines (own vertex stage, WebGL, three.js) use [`<surface>`](./surface-paint.md), which owns its canvas outright.
