# `@inspect` Variables

Mark a top-level `const` with an `@inspect` JSDoc tag and the editor's right sidebar grows a control for it, at the stage level, below the background picker. Moving the control moves the composition **live** — the variable is compiled into a signal on the editor's reactive graph, so nothing remounts — and the value it settles on is written back into the initializer, the same way a dragged rect lands in the file.

```tsx
/** @inspect number min=0 max=100 step=1 */
const padding = 24;

/** @inspect font path="Typography/Font" */
const fontFamily = "Inter";

/** @inspect color path="Typography/Color" */
const textColor = "#ff3366";

/** @inspect text */
const title = "Hello world";

export default function Project() {
  return (
    <stage>
      <scene width={1920} height={1080}>
        <text x={padding} fontFamily={fontFamily} fill={textColor}>{title}</text>
      </scene>
    </stage>
  );
}
```

## The annotation

```
@inspect <type> [min=…] [max=…] [step=…] [options="a,b,c"] [path="Group/Label"] [label="Label"]
```

| Type | Control | Initializer |
| ---- | ------- | ----------- |
| `number` | Slider when `min` and `max` are both given, a draggable number field otherwise | a number literal |
| `color` | Color picker | a string literal (`"#ff3366"`) |
| `text` | Text area | a string literal |
| `font` | Font picker (web + system fonts) | a string literal naming the family |
| `boolean` | Toggle | `true` or `false` |
| `select` | Dropdown over `options="a,b,c"` (required, at least two) | a string literal that is one of the options |

`min`, `max` and `step` only apply to `number`; `options` only to `select`.

```tsx
/** @inspect boolean */
const showFrame = true;

/** @inspect select options="left,center,right" */
const align = "center";
```

**Identity is the file and the variable name** — nothing else. Renaming the variable renames the control's identity; no id is minted, and nothing extra is written into your source.

**Presentation derives from the name.** The label is the variable's own name prettified (`fontFamily` → "Font Family"), and the control sits ungrouped under a "Variables" section. `path="Typography/Font"` overrides both: the last segment is the label, the segments before it the group the control is filed under. `label="Font"` names the control without grouping it. Deeper paths (`"Theme/Colors/Primary"`) flatten into one section title ("Theme / Colors").

## Rules

- **Top-level `const` only**, one declaration per annotation, initialized with a plain literal matching the type — the literal is what the editor overwrites.
- **Not exportable.** References are rewritten per file, so an importer would receive the accessor where it expects the value. Declare the variable in the file that uses it.
- **Module-level derivation is computed once.** `const doubled = padding * 2` at the top level does not follow the slider — like any module-level expression, it runs once at evaluate. Reads inside JSX props and component bodies are reactive; derive inside the component (or a memo) when the derivation should be live.
- **An initializer you rewrite into an expression is yours again.** The write-back only touches a declaration that still carries the annotation and still holds a literal; anything else is skipped, like a prop bound to an expression.

## How it behaves

- Changes are debounced into the same write pipeline as canvas edits, land in the undo history (slider bursts coalesce into one step), and never trigger a recompile or remount — the file catches up with the canvas, not the other way round.
- A hand edit to the file reloads the project as always; the controls rebuild from the new source.
- Export and capture recompile from source, so the values the inspector settled on are the values a render uses.
