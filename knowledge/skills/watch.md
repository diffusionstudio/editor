# Watching footage

How to understand source material. Inspect only the modalities the question turns on — speech, action, music, graphics, or atmosphere may lead, so there is no fixed priority. Sample the picture against what the audio tells you.

- **Always probe first.** `media_probe` reports the container and its tracks, telling you up front whether the file has a video track, an audio track, or both. Everything after branches on that.
- **Get the lay of the land.** Render a `media_waveform` (audio) and a `media_filmstrip` (video) for a fast, cheap overview of where the loud and quiet stretches fall, and where the visual scene changes are. A filmstrip shows coarse structure and scene state, not crop, framing, readability, or an exact cut frame.
- **Listen to the audio.** Run `media_listen` with a prompt tailored to the context (what you actually need to know), and explicitly ask the model to include timestamps in its answer. See [media-listen.md](../guides/prompts/media-listen.md) for prompt patterns.
- **Transcribe speech.** For speech, `media_transcribe` returns the full transcript with word-level start/end times directly — read any segment straight from it.
- **Sample the video against the audio.** Use `media_grab` to pull frames. When the audio has already pointed you at specific moments, feed those timestamps straight in from the transcript or listen output as `times` (e.g. `00:32`, `00:45`). When you need a visual pass without such cues, reach for `auto`: it scans the footage and keeps only the frames where the picture settles into a new visual state, dropping near-duplicates.

# Matching depth to the question

Read only as much of the footage as the answer requires — each pass costs time, and `media_listen` costs credits.

- A duration or format question ends at `media_probe`.
- "Where is the quiet part" or "how is it paced" is usually answered by the waveform and filmstrip alone.
- A question about what was said resolves fastest through `media_transcribe`; quote the transcript and its times directly.
- Questions about non-speech audio (music, tone, sound events, speaker identity) are what `media_listen` is for.
- Only questions about what is *seen* need frames — and the audio pass usually tells you which moments to grab, so grab those instead of scanning blind.
- For open-ended questions ("summarize this", "what happens here"), combine passes: structure from waveform + filmstrip, content from transcript or listen, then frames at the salient moments to confirm what the picture shows.

# Answering

- Ground every claim in something you actually saw or heard — a transcript line, a listen answer, a grabbed frame. If the evidence is ambiguous, say so rather than smoothing over it.
- Anchor answers to the timeline. Give timestamps as `MM:SS` (or `HH:MM:SS` for long footage) so the user can jump straight to the moment; for a scene or segment, give its start and end.
- When asked to find a scene or moment, return the timestamp range plus a one-line description of what identifies it, so the user can confirm it is the right one.
- Summaries follow the footage's own structure: what happens, in order, with the timestamps where each part begins. Length matches what the user asked for, not what the footage contains.
- This skill only reads footage. When the user wants the footage changed — cut, composed, captioned, exported — that is the `editor` skill's job.
