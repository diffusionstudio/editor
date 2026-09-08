# Footage analysis

How to understand source material before editing it. Inspect only the modalities the decision turns on — speech, action, music, graphics, or atmosphere may lead, so there is no fixed priority. Sample the picture against what the audio tells you.

- **Always probe first.** `dapi media probe <id|path>` reports the container and its tracks, telling you up front whether the file has a video track, an audio track, or both. Everything after branches on that.
- **Get the lay of the land.** Render a `dapi media waveform` (audio) and a `dapi media filmstrip` (video) for a fast, cheap overview of where the loud and quiet stretches fall, and where the visual scene changes are. A filmstrip shows coarse structure and scene state, not crop, framing, readability, or an exact cut frame.
- **Listen to the audio.** Run `dapi media listen` with a prompt tailored to the context (what you actually need to know), and explicitly ask the model to include timestamps in its answer. See [media-listen.md](../guides/prompts/media-listen.md) for prompt patterns.
- **Transcribe speech.** For speech, `dapi media transcribe` prints the full transcript with word-level start/end times directly — read any segment straight from it.
- **Sample the video against the audio.** Use `dapi media grab` to pull frames. When the audio has already pointed you at specific moments, feed those timestamps straight in from the transcript or listen output, e.g. `-t '00:32' '00:45' ...`. When you need a visual pass without such cues, reach for `--auto`: it scans the footage and keeps only the frames where the picture settles into a new visual state, dropping near-duplicates.

# The editing loop

- Write the brief first. For anything nontrivial, capture the edit as a markdown file: it is the plan every save works toward and the thing to check the result against.
- Lay down the A-roll. Assemble the primary footage as JSX and save. Get the spine of the edit right before anything else.
- Layer the rest on top. Once the A-roll holds, add B-roll and secondary assets (sound effects, captions, overlays) in the same source.
- Symlink media the project uses into its `assets/` folder and name it by library path (`assets/b-roll/drone.mp4` is `"b-roll/drone.mp4"`); local and remote paths work too but stay outside the library.
- `dapi context` reports which folder the app actually has open, where the playhead sits, and where every `generate.*` declaration stands — poll it to wait for generations without blocking.

**The source is the document.** A project is a folder of JSX; Use `dapi open <dir>` once, then write the files and save. Saving recompiles and re-renders the canvas.

# Compositing

- Chrome, scaffolding, and ornament all draw from a visual budget whose default balance is `0`; prefer not to use them. A cut, hold, or change of size can separate two ideas as clearly as a divider without adding visual clutter. An element earns its place by deepening the story, guiding attention, or expanding imagination, never by filling space.
- Video is its own medium, with its own rules; it is not a website, poster, slide, or UI. It is watched, not read.
- Don't darken, blur, or cover the picture to make something on top of it legible
- Let visuals, sound, and voice carry context; let text punctuate rather than explain. Do not add copy, eyebrows, labels, underlines, or brand color highlights unless the brief or explicit video guidance calls for them; examples alone are not instructions.
- Choose easing from the intended weight, energy, and continuity of the action.
- When the brief, project, or user specifies branding, follow it. Only when none is specified, fall back to the [Diffusion Studio brand](../brand/README.md) — its design, voice, video, and library references, and the components and compositions bundled with them.

# Verification

How to confirm a change actually produced what you intended. A clean save does not guarantee a correct-looking composition.

- Run `dapi check <id>` first. It catches black frames, clips that never become visible, zero-duration or fully transparent nodes, and assets that failed to load or generate.
- Use `dapi capture <id>` to see what the viewer actually gets.
- Reconcile captured frames with the brief, and the brief with these guidelines.
- Verify after every stage, not only at the end — build the composition incrementally so a problem is caught next to the change that caused it.
- Scale verification to the change. A small or incremental tweak the user asked for needs no visual confirmation so the user gets the result back fast and can keep iterating.
- Fix the largest viewer-facing problem before polishing details, and recheck related moments after structural changes, since pacing, continuity, emphasis, and meaning are relational.
- Use `screenshot` or `logs` to debug issues.
- DO NOT export/render the scene for visual confirmation — `dapi capture` is equivalent to a render but far more efficient. Rendering to a video should be a user-triggered action unless explicitly requested in the prompt.

# Best practices

- Wrap clips in `<sequence>` tags wherever the parent tag supports it — A-roll, B-roll, and other clips belong in sequences so the timeline stays structured rather than a flat, messy pile. A sequence does not place its children: give every clip an explicit `start`.
- Use the built-in tags for the media a composition is made of (audio, video, images, captions).
- Hoist the properties that define the composition's look — title copy, font family and size, accent colors, key padding — into top-level consts annotated with `@inspect`, so they become live controls in the app's inspector.
- For anything 3D, use Three.js drawn into a `<surface>` tag.
- For motion graphics, overlays and UI-heavy graphics, the `<html>` tag driven by a paused [anime.js](https://animejs.com) timeline
- Before animating anything, read the [easings reference](../guides/motion/easings.md) and choose easings deliberately — default or linear easing is what makes motion read as a slideshow.
- Add auto captions last, after everything else is assembled, so they transcribe the finished audio at its final placement.
- Open the application in the background (`dapi open -b`) for tasks that don't require an editing UI.
- Only render (export) the result when prompted.
- Start with a fresh project.

# Docs

The authoring reference is served by the app for the installed version: read it there and trust it over memory.

- [JSX reference — elements, timing, paints, generation, captions](../reference/jsx/README.md)
- [Tool reference — every tool, its arguments and its output](../reference/tools/README.md)
- [Examples — complete compositions, basics through shaders](../examples/README.md)
- [Easings: which cubic-bezier to use and when](../guides/motion/easings.md)
- [Diffusion Studio brand — the fallback when no other branding is specified](../brand/README.md)

# Examples

Read worked example(s) that match your context.

## Video editing

- [Long-form talking head](../guides/walkthroughs/talking-head.md)
- [Podcast clipping](../guides/walkthroughs/podcast-clip.md)

## Prompts

- [Writing prompts for `dapi media listen`](../guides/prompts/media-listen.md)
