# Media source resolution

`src` (on [`<video>`](./video.md), [`<image>`](./image.md), [`<audio>`](./audio.md), the [media paints](./paints.md#media-paints), [`<captions>`](./captions.md), and the DOM [`<img>`](./html.md#images) inside `<html>`) accepts:

- **Library path**: e.g. `"b-roll/drone.mp4"`, an asset of the project's library by its path there (folder + name, as shown in the asset panel and recorded in the project's `assets.yml`). The preferred form: it is portable and survives the file being relinked.
- **Asset id**: e.g. `"9f3a2c1d7e4b8a01"`, the content hash of a library asset (`assets.yml` lists them).
- **Global path**: e.g. `"/Movies/video.mp4"`, resolved against the user's OS. Not added to the library.
- **Remote URL**: e.g. `"https://my.videoarchive.com/audio/clip.wav"`, fetched on mount. Not added to the library.
- **`AssetRef`**: the value returned by a `generate.*` declaration (see [generate.md](./generate.md)). The node is mounted immediately as a placeholder and its paint is attached once the asset has generated; the result is stored under the library's `generated/` folder.

Resolution is **asynchronous and non-blocking**: the element is on the canvas as soon as the project mounts, showing a generating state until its source lands. A source that never lands leaves the element carrying an [`error`](./errors.md#failed-sources).

An `<img>` inside [`<html>`](./html.md) additionally takes a `data:` or `blob:` URL, which goes to the browser as it is.

## Image sequences

A path naming a **directory of numbered frames** (`shot_001.png`, `shot_002.png`, …) is an image sequence, and plays on `<video>` or `<image>` exactly as footage does.

A folder of pictures has a count, not a duration, so `frameRate` is what says how long the clip runs: 600 frames at 24 is 25 seconds, at 60 is 10. Default 30. There is nothing for encoded video or a still to read it against — a file carries its own rate, and neither has a frame count to divide.

```tsx
<video src="renders/beauty-pass" frameRate={24} width={1920} height={1080} />
```

`frameRate` is not [`playbackRate`](./timing.md#playback-rate), which retimes a source against the timeline whatever its natural speed is; this is what that natural speed *is*. It is unrelated to the composition's own frame rate, which the export sets.

## Source modifiers

`<image>` and `<video>` take props that put the source through a model before the element shows it:

| Prop | On | Meaning |
| ---- | -- | ------- |
| `removeBackground` | `<image>` | Cuts the subject out, leaving the rest transparent. |
| `upscale` | both | Resolution multiplier — `upscale={2}` asks for twice the pixels. Enlarges the source, not the box. |
| `addAudio` | `<video>` | Scores footage that has no sound. Independent of `volume` and `muted`, which mix whatever track the clip ends up with. |

```tsx
<image src="footage/fox.png" removeBackground upscale={2} width={800} height={450} />
```

The `src` goes on naming what the picture was made from, so taking a modifier off gives the original back — nothing is overwritten and nothing is lost. Results are cached by source and modifiers, like [generated assets](./generate.md#caching-and-idempotency) and stored in the same `generated/` folder, so one is made however many elements ask for it, and adding a second modifier does not re-run the first. They are applied in the order of the table above, whatever order they are written in.

Modifiers compose with declarations: `<image src={generate.image({ prompt: "a red fox" })} removeBackground />` generates, then cuts out.

## The library

A project's assets are recorded in `assets.yml` next to its entry file: for each asset, its library `path`, where its bytes are (`source`: the absolute path of a file imported from disk — imports never move or copy files — or a project-relative path under `assets/`, whether the app wrote the bytes there or a symlink points at them), and what it was found to be. Folders are listed too, so an empty one survives a reload. Renaming or moving an asset in the panel rewrites the `src` props that named it.

## Adding an asset

Symlink the file into the project's `assets/` folder and it is in the library. The app is watching, so it lands while the project is open; a project that is closed takes it in on the next open. Its library path is where the link sits under `assets/` — folder and name, so `assets/b-roll/drone.mp4` is `"b-roll/drone.mp4"` and `assets/logo.png` is `"logo.png"`.

```sh
mkdir -p assets/b-roll && ln -s ~/Movies/drone.mp4 assets/b-roll/
```

```tsx
<video src="b-roll/drone.mp4" width={1920} height={1080} />
```

Link rather than copy: the bytes stay where they are, the project holds nothing but a name for them, and the library still gets a portable path to reach them by. Give `ln -s` an absolute target — a relative link is read against the folder the link sits in, so it breaks as soon as the project moves. A directory of numbered frames is taken in whole, as one [image sequence](#image-sequences), rather than as a file each, and a link to that directory does the same. [`dapi fetch`](../fetch.md) writes to disk and nothing else, so `-o assets/b-roll/` is how a download becomes an asset; `generate.*` results arrive under `assets/generated/` on their own.

A link is the project's, and what it points at is not. Deleting a linked asset in the panel removes the link and stops there.

This is the way in from outside the app: there is no command that adds an asset, and `assets.yml` is not an entry point — a record carries the content hash the app computes for it, and a malformed one is dropped on load. The asset panel does the same thing from inside the app: an imported file is linked where it lies, recorded by its absolute path, never copied. A file that should not move and does not need a library path is named by its absolute path in `src` instead, at the cost of the portability a library path has.
