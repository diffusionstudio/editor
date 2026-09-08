# Diffusion Studio visual guide

Define color, type, identity, imagery, layout, safe areas, and captions. Use `video.md` for motion and sound, `voice.md` for words, and `library.md` for reusable files.

Scale every pixel value below from a short edge of 1080.

## Visual principles

- Build structure with scale, weight, spacing, and luminance.
- Keep the frame near-achromatic. Use color only when it carries meaning.
- Show the product clearly. Do not decorate over controls or content the viewer must read.
- Prefer one clear focal point to several equal points.

## Color

Use these hex values in Diffusion Studio source.

| Role | Value |
| --- | --- |
| Background | `#000000` |
| Surface | `#161616` |
| Text | `#F8F8F8` |
| Text, secondary | `#A4A4A4` |
| Brand red | `#F43535` |

Default to leaving red out. It lives on the app icon. At most one element may carry it. Never
use it for a title or a large fill. The app's destructive state is `#E62D2D`, so red beside
product UI may read as an error.

`#008CFF` is the product blue. Use it only when it already appears in real product UI. Never
use it as a brand accent.

Place text on `#000000` or `#161616`. Do not rely on a shadow or stroke for contrast.

## Typography

Use `Geist`. Use `Geist Mono` for code and figures. Do not use italic.

| Role | Size | Weight | Copy limit |
| --- | ---: | ---: | ---: |
| Title | 96 | 600 | 32 characters |
| Subtitle | 60 | 400 | 64 characters |
| Lower-third name | 48 | 500 | 28 characters |
| Lower-third detail | 30 | 400 | 40 characters |
| Label | 24 | 500 | 16 characters |

Rewrite copy that exceeds a limit. Do not shrink the type. Confirm that Geist and Geist Mono
are available before final output; no font files are bundled yet.

## Logo and icon

Use `assets/logos/logo-white.svg` or `assets/logos/icon-white.svg` on a dark, quiet background. Use the wordmark when the name must be clear. Use the icon only when the product is already named or the small space cannot hold the wordmark.

Do not tint, outline, stretch, crop, rotate, rebuild, or place either mark over busy footage.
No dark mark, minimum size, clear-space rule, or video-scale logo bug has been supplied. Do not
invent one.

## Product imagery

- Show real product UI. Do not reconstruct or recolor it.
- Use `contain` when viewers must read the whole interface.
- Use `cover` only when the crop cannot hide a control, label, or result needed for the point.
- Keep product captures sharp and at their native aspect ratio.
- Use a plain surface around captures instead of stretching them to fill a frame.
- Add photography or illustration only when the request or library supplies a suitable asset.

## Layout and aspect ratios

Use a margin of 64 and a gap of 40. Use other spacing in multiples of 8: 16 between a label and
value, 24 between lines in one block, and 40 between separate blocks.

Use a corner radius of 24 on framed media panels. Do not round full-frame media.

Left-align copy and anchor it low. Center copy only when it stands alone on a plain background.
Use at most two text elements in one shot: a primary line and its qualifier.

Use these media forms:

- **Full frame:** one product view or one dominant subject.
- **Two-up:** two states, inputs, speakers, or before-and-after views.
- **Four-up:** a set of equal details that remain legible at delivery size.

Keep two-up panels square when the source allows it. Place them side by side in 16:9 and 1:1,
and stack them in 9:16. Use a centered 2×2 grid for four-up. Use
`assets/components/media-grid.tsx` for the tested geometry.

### 9:16 text safe area

At 1080×1920, keep readable content inside `x 64–900`, `y 200–1520`. The right 180 is the platform action rail and the bottom 400 is the caption reserve. Graphics may cross these bounds; text may not.

## Captions

Use `stark` for 9:16 output and `cascade` for other ratios. Pass no `colors`; neither preset
exposes color slots. On 9:16, do not add another bottom offset to the preset.

A preset carries its own legibility. Never put a band, plate, or gradient behind captions. When one
does not read over the footage, change the preset or its `verticalAlign` or `offsetY`; if it still does not read,
that is the answer for that stretch, not a reason to dim the picture.

## Known gaps

The brand has no bundled fonts, dark logo, approved video logo bug, image library, shared code
text size, or measured minimum logo size. Name the gap when a task depends on one.
