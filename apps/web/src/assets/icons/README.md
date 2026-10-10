# Icons

Every `*.svg` in this folder is an icon. `<Icon name="trash" />` ([icon.tsx](../../components/ui/icon.tsx)) renders `trash.svg` at **25×25 px**. The file name is the icon name.

The icons are drawn on a **25×25 pixel grid** so they render sharp on 1x screens. The icons in the
[Figma UI library](https://www.figma.com/design/aLnWQdH3C7hqlQVYnsac9s/Diffusion-Studio---UI-Library?node-id=2270-51319&m=dev)
are 24×24 components (`icon.24.<name>`), so an icon has to be redrawn when it comes over, not just exported.

## Why 25 and not 24

The icons are mostly 1px lines. A 1px line is only sharp when it fills one pixel column exactly, i.e. when its
centerline sits on a half pixel (`x = 12.5` covers pixels 12–13). In a 24 frame the center is 12, so a centered
line covers half of pixel 11 and half of pixel 12 and renders as a 2px grey smear. In a 25 frame the center is
12.5, so centered 1px lines are sharp.

The Figma exports have two more problems:

- **Lines are outlined.** Each 1px stroke comes out as a filled shape with two parallel edges.
- **Odd scales.** Many icons were scaled, so their strokes are 0.8, 0.93 or 1.1 px instead of 1 px.

Neither can be fixed by just shifting the icon. Redraw it as clean 1px strokes instead.

## Converting a Figma icon

### 1. Export it

In Figma, select the icon component (e.g. `icon.24.trash`). Then either right-click → **Copy/Paste as → Copy as SVG**, or use **Export → SVG** in Dev Mode. You get something like:

```svg
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M10.1331 5.93335C9.87541 5.93335 9.66647 6.14229 9.66647 6.40002C9.66647 6.65775 9.87541 6.86668 10.1331 6.86668H13.8665C14.1242 6.86668 14.3331 6.65775 14.3331 6.40002C14.3331 6.14229 14.1242 5.93335 13.8665 5.93335H10.1331ZM7.7998 8.26668C7.7998 8.00895 8.00874 7.80002 8.26647 7.80002H9.66647H14.3331H15.7331C15.9908 7.80002 16.1998 8.00895 16.1998 8.26668C16.1998 8.52441 15.9908 8.73335 15.7331 8.73335H15.2665V16.2C15.2665 16.7155 14.8486 17.1333 14.3331 17.1333H9.66647C9.15101 17.1333 8.73314 16.7155 8.73314 16.2V8.73335H8.26647C8.00874 8.73335 7.7998 8.52441 7.7998 8.26668ZM9.66647 8.73335H14.3331V16.2H9.66647V8.73335Z" fill="currentColor"/>
</svg>
```

### 2. Read the geometry

Work out what the outline is made of: the **centerline** of each stroke and the stroke width. Each pair of
parallel edges is one stroke, and its centerline is halfway between them. For the trash icon:

| Part | Edges in the 24 frame | Centerline | Width |
| --- | --- | --- | --- |
| Handle | y 5.93–6.87, x 9.67–14.33, round ends | y 6.4, x 10.13–13.87 | 0.93 |
| Lid | y 7.8–8.73, x 7.8–16.2, round ends | y 8.27, x 8.27–15.73 | 0.93 |
| Can sides | x 8.73–9.67 and 14.33–15.27 | x 9.2 and 14.8 | 0.93 |
| Can bottom | y 16.2–17.13, rounded outer corners | y 16.67 | 0.93 |

The 0.93 width means this icon was scaled; it becomes 1.

### 3. Redraw it in the 25 frame

Add 0.5 to every coordinate (12 → 12.5), then snap following these rules:

- **1px strokes on half pixels.** Every stroke is `stroke="currentColor"` with the default width of 1, and horizontal and vertical centerlines on `.5`. A stroked rect therefore has `.5` x/y and whole-number width/height: `<rect x="6.5" y="6.5" width="12" height="12"/>`.
- **Solid shapes on whole pixels.** Genuinely filled shapes (a solid triangle, a lock body) keep `fill="currentColor"`, with their straight edges on whole numbers.
- **Symmetric stays symmetric.** Mirror about `x = 12.5` / `y = 12.5`. A centered line goes on 12.5; a centered box has an odd outer size (e.g. 7…18 = 11, or 6…19 = 13).
- **Even stays even.** Repeated bars, dots or holes stay the same size with equal gaps. If the original spacing can't be both even and sharp (e.g. 2.5 px), use the nearest whole spacing that is.
- **Uniform weight.** Strokes of about 0.75–1.25 px all become 1 px, diagonals and curves included. Don't mix weights unless the design clearly does.
- **Stay close.** Move each part by at most ~0.5 px (1 px if the rules above need it). Keep corner radii, round vs square caps and joins (`stroke-linecap="round"`, `stroke-linejoin="round"`), opacity layers and arrowhead angles.
- **Diagonals and curves.** These can't be fully sharp. Run 45° lines through pixel centers (`.5, .5` points). Give circles centered on 12.5 a whole-number radius so their top, bottom, left and right edges are sharp.

For the trash icon:

| Part | Centerline + 0.5 | Snapped |
| --- | --- | --- |
| Handle | y 6.9, x 10.63–14.37 | `M10.5 6.5H14.5` (4 long, centered) |
| Lid | y 8.77, x 8.77–16.23 | `M8.5 8.5H16.5` (8 long, centered) |
| Sides | x 9.7 and 15.3 | x 9.5 and 15.5 (symmetric about 12.5) |
| Bottom | y 17.17 | y 17.5, corner radius 0.5 |

```svg
<svg viewBox="0 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M10.5 6.5H14.5M8.5 8.5H16.5M9.5 8.5V17C9.5 17.2761 9.7239 17.5 10 17.5H15C15.2761 17.5 15.5 17.2761 15.5 17V8.5" stroke="currentColor" stroke-linecap="round"/>
</svg>
```

### 4. Clean up

The root element is always `<svg viewBox="0 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg">`, with no
`width`/`height`. Beyond that:

- **Colors.** Use `currentColor` instead of Figma's hard-coded colors, so the icon follows the text color. Keep a fixed color only when the design really needs one.
- **No wrappers.** Remove `transform`s, `clipPath`s that don't clip anything, masks, `<g>` wrappers and Figma ids.
- **Short coordinates.** Use absolute path commands and at most 4 decimals.

### 5. Check it at 1x

Render the icon at 25 px with a device pixel ratio of 1 and zoom in with nearest-neighbour scaling:

```bash
rsvg-convert -w 25 -h 25 -b white trash.svg | magick - -filter point -resize 1600% /tmp/trash-1x.png
```

Straight lines should be solid single-pixel rows and columns, with no grey row next to them. Only diagonals and curves
may show grey pixels. Compare the result with the Figma original next to it at the same zoom; apart from the sharpness,
they should look the same.

### 6. Add it

Save the file as `<name>.svg`, using the Figma name without `icon.24.` (`icon.24.trash` → `trash.svg`). Then use it as
`<Icon name="trash" />`. Remove icons from this folder once nothing references them.

## Exceptions

A few icons stay on their own grid on purpose:

- **Brand logos** (`agent.*`, `claude`, `codex`, `social.*`, `diffusion-logo*`) are moved to the 25 frame without reshaping.
- **The `large-*` provider logos** are left as exported.
- **`frame`** (20×20, shown at 20 px), **`folder-thumbnail`** (32×24) and **`vertical-knob-line`** are drawn for their own sizes.
- **`line-join-*`** use a 15×15 grid because they are shown at 14 px.
