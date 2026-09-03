<p align="center">
  <a href="https://diffusion.studio">
    <img src="assets/banner.png" alt="Diffusion Studio" width="700" />
  </a>
</p>

<p align="center">The professional video editor built for agents</p>

<p align="center">
  <a href="https://www.diffusion.studio/download"><img src="https://img.shields.io/badge/Download-macOS%20Apple%20Silicon-161616?style=flat&logo=apple&logoColor=F8F8F8&labelColor=000000" alt="Download for macOS (Apple Silicon)" /></a>
  <a href="https://discord.com/invite/zPQJrNGuFB"><img src="https://img.shields.io/discord/1115673443141156924?style=flat&logo=discord&logoColor=F8F8F8&label=Discord&labelColor=000000&color=161616" alt="Discord" /></a>
  <a href="https://x.com/diffusionhq"><img src="https://img.shields.io/badge/Follow%20for-Updates-161616?style=flat&logo=x&logoColor=F8F8F8&labelColor=000000" alt="Follow on X" /></a>
  <a href="https://www.ycombinator.com/companies/diffusion-studio"><img src="https://img.shields.io/badge/Combinator-F24-161616?style=flat&logo=ycombinator&logoColor=F8F8F8&labelColor=000000" alt="Y Combinator F24" /></a>
</p>

<p align="center">
  <code>npx skills add diffusionstudio/skills</code>
</p>

<br />

<p align="center">
  <a href="https://app.diffusion.studio">
    <img src="assets/desktop-screenshot.png" alt="The Diffusion Studio editor" width="800" />
  </a>
</p>

<br />

## Diffusion Studio

Edit videos with Codex, Claude Code, OpenCode, or Pi. Refine any output in a fully featured editing environment.

Every edit you make is written to real code, so the agent always sees the latest version. A headless mode is available too.

## What people do with it

Drop your raw footage and files into a folder, then ask for the video you want. That's it.

The agent handles everything from there:

- Cuts the clips
- Removes filler words
- Adds subtitles
- Applies color correction and filters
- Handles animations
- Renders the final video

Beyond finishing a cut, it covers:

- **Motion graphics**: explainers, promos, and title sequences
- **Generative assets**: images, video, and voiceover, declared in code and composited into the timeline
- **Clipping**: highlights from a long video, reformatted for social
- **Video understanding**: summaries, scene search, quotes with timestamps

## How it works

Diffusion Studio uses [SolidJS](https://www.solidjs.com) modules as the document source. Think IDE, but it renders a video canvas instead of text.

Editing works both ways: change something on the canvas and the code updates; change the code and the canvas redraws.

The desktop app includes command-line tools that let agents watch and listen to footage, edit it on a timeline, and render the result.

## Getting started

Download the desktop app, it walks you through setting everything up:

<a href="https://www.diffusion.studio/download"><img src="https://img.shields.io/badge/Download-Diffusion%20Studio-161616?style=for-the-badge&logo=apple&logoColor=F8F8F8&labelColor=000000" alt="Download Diffusion Studio" /></a>

Use with Claude Code, Codex, Cursor, Copilot, or Gemini CLI. `/editor` is the main skill you'll use. Ask for what you want in plain language. Behind it is `dapi`, the CLI that drives the app.

## Prompt examples

<details open>
<summary><b>Motion graphics</b></summary>

```text
/editor Create a ~20-second promo for vercel-labs/native in Vercel's presentation style. Research its official website, GitHub, and brand guidelines; use authentic assets and verified product features, with crisp typography, polished motion, and a strong final CTA.
```

```text
/editor Recreate the 3blue1brown animation from https://youtu.be/HEfHFsfGXjs, closely matching its visual style, pacing, framing, colors, labels, and transitions. Use the exact collision mathematics from Gregory Galperin's original paper, do not approximate the physics.
```

</details>

<details>
<summary><b>Video editing</b></summary>

```text
/editor edit the footage in /path/to/folder
```

```text
/editor turn this footage into a polished YouTube video. Add readable captions and an attention-grabbing graphic in the opening to give viewers a strong visual hook.
```

</details>

<details>
<summary><b>Clipping</b></summary>

```text
/editor Can you pull the best 30-second moment from https://youtu.be/MtQ0qxyf-Ds and make a vertical version for social?
```

```text
/editor Make a 15-second version of this launch video. https://x.com/claudeai/status/2045156267690213649
```

</details>

<details>
<summary><b>Video understanding and reasoning</b></summary>

```text
/watch In three bullets, explain what starts the conflict. Include timestamps. https://youtu.be/aqz-KE-bpKQ
```

```text
/watch Name three recurring locations and give one visual cue that distinguishes each. https://youtu.be/dQw4w9WgXcQ
```

</details>

## Made with Diffusion Studio

Both were created by prompting. The compositions are published in [diffusionstudio/open-projects](https://github.com/diffusionstudio/open-projects):

| [Launch video](https://github.com/diffusionstudio/open-projects/tree/main/launch-video) | [Raise announcement](https://github.com/diffusionstudio/open-projects/tree/main/raise-announcement) |
| --- | --- |
| <img src="assets/launch-video.gif" alt="Launch video" width="420" /> | <img src="assets/raise-announcement.gif" alt="Raise announcement" width="420" /> |

## Compositions as code

A project is a folder of that JSX: `dapi open <dir>` once, then edit the files. Saving recompiles the entry file and mounts it directly into the editor's ECS.

Every element carries an `id`, which is how the write-back finds its target: a rect dragged on the canvas, a clip trimmed on the timeline, or a retyped line lands as a prop on the element that authored it.

The root is a `<stage>` holding one `<scene>` per frame you cut in:

```tsx
import { For } from "solid-js";
import { generate } from "@diffusionstudio/jsx";

const hero = generate.image({ prompt: "A neon city at night, cinematic", aspectRatio: "16:9" });
const motion = generate.video({ prompt: "slow camera push-in", startFrame: hero, duration: 5 });

const TITLES = [
  { text: "The Grid", start: 0, end: 2.5 },
  { text: "Neon Nights", start: 2.5, end: 5 },
];

export default function Project() {
  return (
    <stage camera={[0.3, 0, 0, 0.3, 85, 150]}>
      <scene name="Intro" width={1920} height={1080} fill="black" active>
        <video src={motion} start={0} end={5} width={1920} height={1080} />
        <For each={TITLES}>
          {(t) => (
            <text
              width={1920}
              height={1080}
              textAlign="center"
              textBaseline="middle"
              fontSize={128}
              color="#FFFFFF"
              start={t.start}
              end={t.end}
            >
              {t.text}
            </text>
          )}
        </For>
      </scene>
    </stage>
  );
}
```

Everything a mount produces stays a first-class editor node, so a person can pick up in the UI exactly where the script left off.

## Seeing and hearing the media

Cutting footage requires understanding it. The CLI ships the inspection tools an agent needs to work with media it cannot watch:

```sh
dapi media probe clip.mp4                                # container + codec metadata, like ffprobe
dapi media grab clip.mp4 -t 0 12 45                      # decode frames to PNGs
dapi media filmstrip clip.mp4                            # grid of video frames
dapi media waveform track.mp3                            # audio waveform, silence flagged
dapi media transcribe interview.wav                      # timed, word-level transcript
dapi media listen interview.mp4 -p "what is said in the intro?"   # ask a multimodal model
dapi capture intro -t 0 2 4                              # the frames a render would produce, by scene id
```

| Command | Purpose |
| --- | --- |
| `dapi open` | Launch the app and open (or create) a project folder, anywhere on disk |
| `dapi context` | Summary of app state |
| `dapi capture` | Render frames of a scene, as an export would, to a labelled contact sheet or one PNG per position |
| `dapi check` | Check a node's subtree for structural mistakes (black-frame gaps, never-visible nodes, failed sources) and report subtree stats |
| `dapi media …` | Inspect a file by id or path: `probe`, `grab`, `filmstrip`, `waveform`, `transcribe`, `listen` |
| `dapi models` / `dapi voices` / `dapi fonts` | Discover generation models, speech voices, local fonts |
| `dapi screenshot` / `dapi logs` | The app itself: capture the window, read recent console output |
| `dapi fetch` | Download a video from yt/tt/ig |
| `dapi whoami` | The authenticated account |
| `dapi report` | Report a bug in the CLI or the app: diagnostics bundled, filed as a GitHub issue via `gh` |

Conventions throughout: single results are one JSON value, collections are JSON Lines, errors go to stderr with exit code `1`. Everything is built to be piped, grepped, and driven by a program.

## Documentation

- [CLI reference](reference/README.md): every command, its options, and its output
- [JSX reference](reference/jsx/README.md): the composition markup with elements, timing, paints, generative assets, and captions
- [Examples](examples/README.md): runnable compositions, from basic scenes and generative assets to three.js and raw WebGPU

## Repository layout

| Path | Package | What it is |
| --- | --- | --- |
| `apps/web` | `@diffusionstudio/web` | The editor UI (Solid + Vite) |
| `apps/desktop` | `@diffusionstudio/desktop` | Electron shell hosting the editor |
| `apps/cli` | `@diffusionstudio/cli` | The `dapi` CLI |
| `packages/runtime` | `@diffusionstudio/runtime` | Headless editor runtime: the koota world, traits, actions, systems, media decoding, capture. No DOM, no Solid |
| `packages/reconciler` | `@diffusionstudio/reconciler` | Evaluates a compiled project bundle and reconciles its element tree onto runtime entities, via Solid's universal renderer |
| `packages/jsx` | `@diffusionstudio/jsx` | The authoring API: element vocabulary, types, and generated assets (`generate.*`) |
| `packages/assets` | `@diffusionstudio/assets` | A project's asset library: the `assets.yml` manifest, content hashing, probing, resolution |
| `packages/encoder` | `@diffusionstudio/encoder` | Offline video/audio/image encoding over runtime worlds (mediabunny) |
| `packages/koota-solid` | `@diffusionstudio/koota-solid` | Solid bindings for koota, ported from `@koota/react` |

## Contributing / local setup

Requirements: Node 20+ and npm.

```sh
git clone https://github.com/diffusionstudio/editor.git
cd editor
npm install

cp apps/web/.env.example apps/web/.env   # required: the app won't run without it

npm run dev
```

To put `dapi` on your PATH (macOS/Homebrew layout; adjust the link target for other setups), link it once:

```sh
npm run symlink:create --workspace=@diffusionstudio/cli
```

The link points at the CLI build, which `npm run dev:desktop` refreshes on every start, so the linked `dapi` always runs the latest code.

`npm run make` builds the artifacts for the host platform: a ZIP and a DMG on macOS, and a ZIP, a `.deb`, an `.rpm` and an AppImage on Linux. The Linux makers need their own tools on the build host — `dpkg-dev` and `fakeroot` for the deb, `rpm` for the rpm, `squashfs-tools` for the AppImage — and each maker only runs when its tool is there.

On a Wayland session the app runs through XWayland, which is what Chromium picks by default; native Wayland (fractional scaling, no XWayland blur) is available with `ELECTRON_OZONE_PLATFORM_HINT=auto`, though it renders incorrectly on some drivers.

Before sending a PR:

```sh
npm run check    # typecheck all workspaces
npm run lint     # lint all workspaces
```

## License

[MPL-2.0](LICENSE)

The brand assets in [apps/desktop/assets](apps/desktop/assets) are not covered by this license. Copyright (c) Diffusion Studio Inc. All rights reserved.
