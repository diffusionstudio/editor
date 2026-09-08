# Writing prompts for `dapi media listen`

`media listen` puts a multimodal model in front of an audio track and answers a prompt about it. A good prompt is specific about what you want and asks for timestamps so the answer lines up with the timeline. With no prompt it returns a general description; the examples below shape that into something more useful.

## Examples
When you refer to a specific moment inside a prompt, use `MM:SS` (e.g. `01:15` for one minute fifteen seconds).

- Summarize the footage in 3 sentences.
- What are the examples given at 00:05 and 00:10 supposed to tell us?
- Describe the key events in this footage. Include timestamps for salient moments.
- Transcribe the speech in the audio. Include timestamps as provided.
- Tell me the name of the music track playing and include the timestamps for start and end.
