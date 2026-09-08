# Diffusion Studio video guide

Define how the brand behaves over time. Use `design.md` for visual rules, `voice.md` for words,
and `library.md` for reusable source.

Work at 30 fps.

## Scene and media structure

Use full frame while one product state carries the point. Move to two-up to compare or connect
two views. Move to four-up only when all four details remain readable. Return to full frame
when one view becomes primary again.

Change the layout because the idea changes, not to add motion. Prefer a hard cut between layout
forms. Carry one element across the cut only when it represents the same object or state.

In 9:16, hold split layouts longer because each panel is smaller. In 1:1, check that both copy
and product UI still have one clear focal point.

## Timing

Enter over 400 ms (`"12f"`). Exit over 200 ms (`"6f"`). Stagger support by 100 ms (`"3f"`).
Keep a single entrance or exit under 600 ms (`"18f"`).

## Easing

Use the nearest anchor and change it only when the motion needs a different quality. Do not use
`linear` unless the movement is mechanical.

| Anchor | Use | Easing |
| --- | --- | --- |
| Entrance | arriving | `cubicBezier(0.2,0.75,0.34,0.94)` |
| Settle | landing or resolving | `cubicBezier(0,0.65,0.51,0.99)` |
| Travel | moving between states | `cubicBezier(1,0.49,0,0.55)` |
| Exit | leaving | `cubicBezier(1,0.02,0.54,0.42)` |

Do not use the `bouncy` or `strong` spring presets.

## Movement

Lead with one element and delay its support by `"3f"`. Stagger repeated items from a meaningful
origin: first, center, or focal point. Let opacity finish before movement so text becomes
readable before it settles.

Use one flourish per beat. Treat a busy scene as a layout problem.

## Cuts and transitions

| Method | Use |
| --- | --- |
| Hard cut on action | energy while authored motion is still moving |
| Jump cut | matched direction and speed across the seam |
| Continuous carry | the same object or state across two beats |
| Hold cut | read-critical text, product UI, and final lockups |

Use a 300 ms `dissolve` only between two shots of the same subject. Use `fadeToBlack` only to
end a video. Do not use `fadeToWhite`, `slideFromLeft`, or `slideFromRight`.

Cut product captures after the needed action or label has been visible long enough to read.
Tighten a slow cut before adding motion.

## Captions

Add captions after the edit and final audio placement. Keep each caption on screen long enough
to read without racing the voice. Use the visual treatment in `design.md`.

## Sound

Use audio supplied for the project or approved in `library.md`.

Give speech priority. Use one clear source for product audio when several copies of the same
capture appear on screen; mute the rest.

No house mix level has been supplied. Do not invent one.
