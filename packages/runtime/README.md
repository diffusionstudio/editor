# @diffusionstudio/runtime

Headless editor runtime built on [koota](https://github.com/pmndrs/koota): traits, world creation and serialization, actions, deterministic systems, media decoding, and capture.

Must work without a DOM and without solid-js so the CLI and node capture can consume it directly. Browser-only concerns (input, keyboard, HUD, timeline canvas UI, persistence) live in `apps/web`; Solid reactivity bindings live in `@diffusionstudio/koota/solid`.
