# fonts

List the fonts a <text> can be set in: every Google Fonts family (downloaded on demand) and the fonts installed on this machine. These family names are valid `fontFamily` values on <text>; each family lists its variants.

| | |
| --- | --- |
| MCP tool | `fonts` |
| CLI | `diffusion fonts [options]` |

## Input

| Field | Type | CLI | Description |
| --- | --- | --- | --- |
| `family` | `string` | `-f, --family <pattern>` | filter to families whose name contains this (case-insensitive) |
| `provider` | `"google" \| "local"` | `-p, --provider <provider>` | filter to Google Fonts families or to fonts installed on this machine |
| `popular` | `boolean` | `--popular` | only the popular families the editor's font picker leads with |
| `weights` | `string[]` | `-w, --weights <weights...>` | filter to variants with the given CSS weights, e.g. ["400", "700"] |
| `style` | `"normal" \| "italic"` | `-s, --style <style>` | filter to variants with the given style, normal or italic |
| `limit` | `integer` | `-l, --limit <n>` | return at most this many families (default: 50) |

Font families listed here are valid `fontFamily` values on [`<text>`](../jsx/text.md); see [jsx/fonts.md](../jsx/fonts.md) for how a family and variant are named in a composition, and [`context`](./context.md) for the families the open project has actually loaded.

Popular families (display and caption faces common in video) come first, then the rest alphabetically. There are thousands of families, so filter by `family` when looking for one. `total` counts every family the filters match; when it is larger than `families.length`, the limit cut the list. Installed fonts are listed only once the app has been granted font access; a family that is both installed and on Google Fonts is listed once, as `google`, since that is the one the editor draws.

## Output

One JSON object:

```ts
{
  families: Array<{
    family:      string;
    provider:    "google" | "local";
    category?:   string;           // Google Fonts: sans-serif, serif, display, handwriting, monospace
    stylesheet?: string;           // Google Fonts CSS URL, for a <link> in <html>
    variants: Array<{
      weight:  string;             // CSS weight, e.g. "400"
      style:   "normal" | "italic";
      source?: string;             // CSS local() source, for an installed font
    }>;
  }>;
  total: number;                   // families matching the filters, before the limit
}
```
