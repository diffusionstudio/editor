# Diffusion Studio brand library

Use this catalog before selecting or making a brand file. References define the brand; bundled
files apply it. Keep one-off project media with its project.

## Components and shared values

| File | Use | Notes |
| --- | --- | --- |
| `assets/components/tokens.ts` | Share brand color, type, spacing, and safe-area values | Keep it in sync with `design.md` |
| `assets/components/title-card.tsx` | Add a title and optional qualifier | Follow title and subtitle limits in `design.md` |
| `assets/components/lower-third.tsx` | Add a name and detail over footage | Keep both lines inside the text safe area |
| `assets/components/callout.tsx` | Add a short label and value | Use it for one fact, not a paragraph |
| `assets/components/media-grid.tsx` | Place one, two, or four media sources | A two-up layout stacks in portrait and sits side by side otherwise |

Components do not own a `<scene>`. Read the matching source for its inputs and copy only the
files the project needs.

## Compositions

| File | Use | Format | Required inputs |
| --- | --- | --- | --- |
| `assets/compositions/product-demo.tsx` | A single product capture with a lower third | 9:16 | `videoSrc`, `name`, `detail` |
| `assets/compositions/product-tour.tsx` | Full frame to two-up to four-up and back | 16:9 by default; may use 9:16 or 1:1 | Four media sources, `name`, `detail` |
| `assets/compositions/end-card.tsx` | A plain branded end card | 9:16 | `title`, `cta` |

Compositions own `<scene>`, timing, and editable inputs. They are starting points, not a second
component system in the Diffusion Studio app.

## Logos

| File | Use |
| --- | --- |
| `assets/logos/logo-white.svg` | Wordmark on a dark, quiet background |
| `assets/logos/icon-white.svg` | Product icon when the name is already clear |

No dark mark is bundled.

## Fonts, imagery, and audio

No font, reusable image, music, sound-effect, or voiceover file is bundled yet. Do not replace a
missing asset with an unlicensed or unrelated file.

Keep reusable fonts in `assets/fonts/`, imagery in `assets/imagery/`, music in
`assets/audio/music/`, sound effects in `assets/audio/sfx/`, and voiceovers in
`assets/audio/voiceovers/`. Reuse a recording only when its words, delivery, and usage rights fit.

## Select media

Use catalog entries and filenames to shortlist likely matches. Inspect those candidates first,
and widen the search only when needed.

## Add to the library

When adding media, record its source and usage rights in this catalog. Add a reusable item only
after it has a clear repeated use. Give a component one job and a small input set. Add a
composition when the scene flow repeats. Do not add a one-off choice as a brand rule.
