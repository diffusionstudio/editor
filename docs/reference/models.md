# Models

Every model [`generate`](./tools/generate.md) runs, and the fields each takes. A request is `model` plus these fields; the API validates it and answers a field it cannot take with what to fix ([local models](#local) are checked by the app the same way). Models of a kind share one set of fields (every image model takes `prompt`, `images`, `aspectRatio`, …), and each model narrows them: the values it offers are in its row. Leave a field out for the model's default. Files are `{ "path": … }` (see [generate](./tools/generate.md#files)).

| Kind | Models | Makes |
| --- | --- | --- |
| [Image](#image) | `nano-banana-2.1`, `nano-banana-pro`, `gpt-image-2.5-sunburst`, `nano-banana-2`, `seedream-5.0-pro`, `flux-3-image`, `flux-2-pro`, `grok-imagine-image-2.0`, `flux-2-klein`, `krea-2-large` | images from a prompt, or edits of reference images |
| [Video](#video) | `veo-3.1`, `veo-3.1-fast`, `kling-3-pro`, `kling-o3-pro`, `seedance-2.5`, `wan-3.0`, `minimax-h3`, `minimax-h3-max`, `flux-3-video`, `grok-imagine-video-1.5` | a clip from a prompt, optionally from a start (and end) frame |
| [Audio](#audio) | `elevenlabs-music`, `elevenlabs-sfx` | music, sound effects |
| [Voice](#voice) | `elevenlabs-v4`, `elevenlabs-v3`, `gemini-3.8-flash-tts` | speech |
| [Tools](#tools) | `bria-rmbg-2.0`, `seedvr-2`, `bytedance-upscaler`, `universal-3.5-pro`, `qwen3.8-omni-flash` | one file in, one file out |
| [Local](#local) | `sam-2.1` | runs on this machine, free: an object's mask, tracked through footage |

## Image

| Field | Type | Description |
| --- | --- | --- |
| `prompt` | `string`, required | what to make, or how to change the reference images; up to 32,000 characters |
| `images` | `{ path }[]` | reference images, or images to edit; up to the model's limit below |
| `aspectRatio` | `string` | output width:height, from the model's row |
| `resolution` | `"1K" \| "2K" \| "4K"` | long edge of about 1024, 2048 or 4096 px, from the model's row; higher costs more |
| `count` | `integer` | images to make, 1–10 (default 1); each is its own file and is charged |

| Model | | References | Aspect ratios | Resolutions |
| --- | --- | --- | --- | --- |
| `nano-banana-2.1` | Nano Banana 2.1 — Google's newest, sharper edits at Flash cost | 14 | 16:9, 9:16, 1:1, 4:3, 3:4 | 1K, 2K, 4K |
| `nano-banana-pro` | Nano Banana Pro — pro control, readable text, ultra consistent | 14 | 16:9, 9:16, 1:1, 4:3, 3:4 | 1K, 2K, 4K |
| `gpt-image-2.5-sunburst` | GPT Image 2.5 Sunburst — precise detail, strong text, true edits | 16 | 16:9, 9:16, 1:1, 4:3, 3:4 | 1K |
| `nano-banana-2` | Nano Banana 2 — fast, high quality, flexible edits | 14 | 16:9, 9:16, 1:1, 4:3, 3:4 | 1K, 2K, 4K |
| `seedream-5.0-pro` | Seedream 5.0 Pro — lifelike scenes, precise multi-image edits | 14 | 16:9, 9:16, 1:1, 4:3, 3:4 | 1K, 2K |
| `flux-3-image` | FLUX.3 Image — BFL's flagship, sharp up to 4K | 10 | 16:9, 9:16, 1:1, 4:3, 3:4 | 1K, 2K, 4K |
| `flux-2-pro` | FLUX.2 Pro — frontier quality, consistent references | 8 | 16:9, 9:16, 1:1, 4:3, 3:4 | 1K |
| `grok-imagine-image-2.0` | Grok Imagine 2.0 — fast, vivid, photoreal | 3 | 16:9, 9:16, 1:1, 4:3, 3:4 | 1K, 2K |
| `flux-2-klein` | FLUX.2 Klein — low budget, high quality, fast | 4 | 16:9, 9:16, 1:1, 4:3, 3:4 | 1K |
| `krea-2-large` | Krea 2 Large — raw, textured, artistic looks | 1 | 16:9, 9:16, 1:1, 4:3 | 1K |

The aspect ratios listed work on every model in its row. Some models take more (`2:3`, `3:2`, `4:5`, `5:4`, `21:9`, `9:21`, `1:2`, `2:1`, `1:4`, `4:1`, `1:8`, `8:1`, `9:19.5`, `19.5:9`, `9:20`, `20:9`), and the API says when one does not.

## Video

| Field | Type | Description |
| --- | --- | --- |
| `prompt` | `string`, required | the shot: subject, action, camera, sound; up to 4,000 characters |
| `startFrame` | `{ path }` | an image the clip starts on |
| `endFrame` | `{ path }` | an image the clip ends on; only models with *end* in their row |
| `duration` | `integer` | seconds, from the model's row |
| `aspectRatio` | `string` | output width:height, from the model's row; a model without any takes its proportions from the start frame |
| `resolution` | `"480p" \| "720p" \| "1080p" \| "2K"` | from the model's row; higher costs more |

| Model | | Frames | Durations (s) | Aspect ratios | Resolutions |
| --- | --- | --- | --- | --- | --- |
| `veo-3.1` | Veo 3.1 — realistic physics, complex scenes | start, end | 4, 6, 8 | 16:9, 9:16 | 720p, 1080p (8 s only) |
| `veo-3.1-fast` | Veo 3.1 Fast — the same engine, lower cost | start, end | 4, 6, 8 | 16:9, 9:16 | 720p, 1080p (8 s only) |
| `kling-3-pro` | Kling 3.0 — cinematic motion with built-in audio | start, end | 3–15 | 16:9, 9:16, 1:1 | 720p |
| `kling-o3-pro` | Kling 3.0 Omni — multi-modal reasoning, strong scenes | start | 3–15 | from the start frame | 1080p |
| `seedance-2.5` | Seedance 2.5 — rich motion, lip-synced audio, up to 30 s | start, end | 4–30 | 16:9, 9:16, 1:1, 4:3, 3:4 | 480p, 720p |
| `wan-3.0` | Wan 3.0 — expressive motion, clips up to 30 s | start | 2–30 | 16:9, 9:16, 1:1, 4:3, 3:4 | 480p, 720p, 1080p |
| `minimax-h3` | MiniMax H3 — native 2K with built-in audio | start, end | 5–15 | 16:9, 9:16, 1:1, 4:3, 3:4 | 2K |
| `minimax-h3-max` | MiniMax H3 Max — faster, cheaper H3 with native audio | start, end | 5–15 | 16:9, 9:16, 1:1, 4:3, 3:4 | 480p, 720p |
| `flux-3-video` | FLUX.3 Video — sharp detail with native audio | start, end | 5–20 | 16:9, 9:16, 1:1, 4:3, 3:4 | 720p, 1080p |
| `grok-imagine-video-1.5` | Grok Imagine Video 1.5 — quick clips from text or a frame | start | 1–15 | 16:9, 9:16, 1:1, 4:3, 3:4 | 480p, 720p, 1080p |

Durations given as a range take any whole second in it.

## Audio

| Field | Type | Description |
| --- | --- | --- |
| `prompt` | `string`, required | the music (genre, mood, instruments, structure, lyrics) or the sound; up to 4,100 characters |
| `duration` | `number` | seconds, within the model's range |

| Model | | Duration (s) |
| --- | --- | --- |
| `elevenlabs-music` | ElevenLabs Music — full compositions, stems, and lyrics | 3–600 (default 30) |
| `elevenlabs-sfx` | ElevenLabs SFX — sound effects, seamless looping | up to 30; left out, the model picks the length |

## Voice

| Field | Type | Description |
| --- | --- | --- |
| `prompt` | `string`, required | the text to speak; up to 10,000 characters (5,000 for ElevenLabs v3). ElevenLabs v3 takes audio tags in brackets (`[whispers]`, `[laughs]`); Gemini takes a style instruction before the text (`Say cheerfully: …`) |
| `voice` | `string`, required | one of the model's voices, from its voice list (linked below) |

| Model | | Voices |
| --- | --- | --- |
| `elevenlabs-v4` | ElevenLabs v4 — lifelike speech, up to 10,000 characters | [an ElevenLabs voice id](./voices/elevenlabs-v3.md) |
| `elevenlabs-v3` | ElevenLabs v3 — expressive speech in many voices | [an ElevenLabs voice id](./voices/elevenlabs-v3.md) |
| `gemini-3.8-flash-tts` | Gemini 3.8 Flash TTS — natural speech, styled in the prompt | [a Gemini voice name](./voices/gemini-3.8-flash-tts.md) |

## Tools

Each takes one file and returns one.

| Model | | Fields | Returns |
| --- | --- | --- | --- |
| `bria-rmbg-2.0` | Bria RMBG 2.0 — background removal | `image`: `{ path }`, required | a PNG of the image with a transparent background |
| `seedvr-2` | SeedVR2 — image upscaling | `image`: `{ path }`, required | a PNG of the image upscaled 2× |
| `bytedance-upscaler` | ByteDance Upscaler — video upscaling | `video`: `{ path }`, required | an MP4 of the video upscaled to 2K at 30 fps |
| `universal-3.5-pro` | AssemblyAI Universal-3.5 Pro — transcription with speaker labels (Universal-2 for languages it lacks) | `audio`: `{ path }` (audio or video) or `{ scene }` (the scene's mix, see [Scenes](./tools/generate.md#scenes)), required; `languageCode`: e.g. `en`, `en_us`, `de` (detected when left out) | `transcript.json`: `[{ text, speaker?, words: [{ text, start, end }] }]`, times in seconds, speakers labelled `A`, `B`, … when told apart |
| `qwen3.8-omni-flash` | Qwen3.8 Omni Flash — describes or answers questions about audio: speech, speakers, music, sounds | `media`: `{ path }`, required: an audio file (wav, mp3, ogg, flac, aac, m4a or aiff) up to 20 MB; `prompt`: what to listen for, up to 10,000 characters (a general description when left out) | `analysis.md`, the answer as Markdown |

## Local

These run in the app, on this machine's GPU: no account, no credits. A job is shaped like the API's and polled the same way with [`job`](./tools/job.md), with two fields of its own — `progress` (0..1 through its current `phase`) and `details` (what the model found) — and lasts only as long as the app: a job id is gone once the app restarts. The first use of a model downloads it.

| Model | | Makes | Fields |
| --- | --- | --- | --- |
| `sam-2.1` | SAM 2.1 — segments an object in a video and tracks it through the footage; `size` tiny (default), small, base-plus or large | a mask file (`.mask`) for a [`<mask src>`](./jsx/styles.md#mask) | [segment.md](./tools/segment.md) |
