# Media source resolution

`src` (on [`<video>`](./video.md), [`<image>`](./image.md), [`<audio>`](./audio.md), the [media paints](./paints.md#media-paints), [`<captions>`](./captions.md), and the DOM [`<img>`](./html.md#images) inside `<html>`) accepts:

- **Library path**: e.g. `"b-roll/drone.mp4"`, an asset of the project's library by its path there (folder + name, as shown in the asset panel and recorded in the project's `assets.yml`). The preferred form: it is portable and survives the file being relinked.
- **Asset id**: e.g. `"9f3a2c1d7e4b8a01"`, the content hash of a library asset (`assets.yml` lists them).
- **Global path**: e.g. `"/Movies/video.mp4"`, resolved against the user's OS. Not added to the library.
- **Remote URL**: e.g. `"https://my.videoarchive.com/audio/clip.wav"`, fetched on mount. Not added to the library.

Resolution is **asynchronous and non-blocking**: the element is on the canvas as soon as the project mounts and its paint is attached once its source has loaded. A source that fails to load leaves the element carrying the reason (see [errors.md](./errors.md#failed-sources)).

An `<img>` inside [`<html>`](./html.md) additionally takes a `data:` or `blob:` URL, which goes to the browser as it is.

## Image sequences

A path naming a **directory of numbered frames** (`shot_001.png`, `shot_002.png`, …) is an image sequence, and plays on `<video>` or `<image>` exactly as footage does.

A folder of pictures has a count, not a duration, so `frameRate` is what says how long the clip runs: 600 frames at 24 is 25 seconds, at 60 is 10. Default 30. There is nothing for encoded video or a still to read it against — a file carries its own rate, and neither has a frame count to divide.

```tsx
<video src="renders/beauty-pass" frameRate={24} width={1920} height={1080} />
```

`frameRate` is not [`playbackRate`](./timing.md#playback-rate), which retimes a source against the timeline whatever its natural speed is; this is what that natural speed *is*. It is unrelated to the composition's own frame rate, which the export sets.

## The library

A project's assets are recorded in `assets.yml` next to its entry file: for each asset, its library `path`, where its bytes are (`source`: the absolute path of a file imported from disk — imports never move or copy files — or a project-relative path under `assets/`, whether the app wrote the bytes there or a symlink points at them), and what it was found to be. Folders are listed too, so an empty one survives a reload. Renaming or moving an asset in the panel rewrites the `src` props that named it.

A file a model generated — in the app's prompt box or with [`generate`](../tools/generate.md) — also records the `job` it came from. [`job`](../tools/job.md) with that id returns what was asked for in `request`: the model, the prompt and every other field (an input file appears there as the API's reference to its upload, not as a library path).

## Adding an asset

Symlink the file into the project's `assets/` folder and it is in the library. The app is watching, so it lands while the project is open; a project that is closed takes it in on the next open. Its library path is where the link sits under `assets/` — folder and name, so `assets/b-roll/drone.mp4` is `"b-roll/drone.mp4"` and `assets/logo.png` is `"logo.png"`.

```sh
mkdir -p assets/b-roll && ln -s ~/Movies/drone.mp4 assets/b-roll/
```

```tsx
<video src="b-roll/drone.mp4" width={1920} height={1080} />
```

Link rather than copy: the bytes stay where they are, the project holds nothing but a name for them, and the library still gets a portable path to reach them by. Give `ln -s` an absolute target — a relative link is read against the folder the link sits in, so it breaks as soon as the project moves. A directory of numbered frames is taken in whole, as one [image sequence](#image-sequences), rather than as a file each, and a link to that directory does the same. A download becomes an asset the same way: point [yt-dlp](https://github.com/yt-dlp/yt-dlp) at `assets/b-roll/` with `-o`.

A link is the project's, and what it points at is not. Deleting a linked asset in the panel removes the link and stops there.

This is the way in from outside the app: there is no command that adds an asset, and `assets.yml` is not an entry point — a record carries the content hash the app computes for it, and a malformed one is dropped on load. The asset panel does the same thing from inside the app: an imported file is linked where it lies, recorded by its absolute path, never copied. A file that should not move and does not need a library path is named by its absolute path in `src` instead, at the cost of the portability a library path has.

## Formats

The editor reads these formats. It identifies audio and video by their bytes, not by their extension, so a WAV saved as `speech.mp3` still opens as a WAV.

| Kind | Formats |
| --- | --- |
| Video | MP4, MOV, WebM, Matroska, and MPEG-TS |
| Audio | WAV, MP3, M4A, AAC, FLAC, Ogg, and AIFF |
| Image | PNG, JPEG, WebP, GIF, SVG, and other images Chromium decodes, such as AVIF and BMP |

AIFF includes AIFF-C. The editor reads either when it holds uncompressed samples, which is what macOS writes. It refuses compressed AIFF-C (IMA 4:1, μ-law, and A-law) with `Unsupported file`.

Any other audio or video format, such as AVI, FLV, WMA, CAF, or an HLS playlist, stays out of the library. The app skips such a file in `assets/`, and an import or a tool call that names it fails with `Unsupported file`, or `Unsupported resource` for a URL. Convert it first, for example with `ffmpeg -i in.avi out.mp4`.

### Make audio with `say`

macOS `say` writes AIFF by default, and the editor reads AIFF, so `say -o speech.aiff "text"` needs no conversion. To make a WAV, give `say` the sample format.

```sh
say --file-format=WAVE --data-format=LEI16@22050 -o speech.wav "text"
```

A bare `say -o speech.wav` fails with `fmt?` and writes no file.

Four other file names exit 0 and still leave nothing the editor can use:

- `-o speech.mp3` writes a 16-byte file with no audio.
- `-o speech.ogg` and `-o speech.opus` write an empty file.
- `-o speech.caf` writes a CAF file, which the editor does not read.

Check the size of a file before you use it. To turn a CAF file into a WAV, run `afconvert -f WAVE -d LEI16 speech.caf speech.wav` or `ffmpeg -i speech.caf speech.wav`.
