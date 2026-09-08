# `dapi fonts`

Lists local fonts available on this machine. macOS only. Does not require the app to be running. Font families listed here are valid `fontFamily` values on [`<text>`](../jsx/text.md).

## Options

- `-f, --family <pattern>`: filter to families whose name contains `<pattern>` (case-insensitive)
- `-w, --weight <weights...>`: filter to variants with the given CSS weight(s), e.g. `-w 400 700`
- `-s, --style <style>`: `"normal"` or `"italic"`
- `-l, --limit <n>`: output at most `<n>` families

## Output

One JSON object:

```ts
{
  families: Array<{
    family:   string;
    variants: Array<{
      weight: string;            // CSS weight, e.g. "400"
      style:  "normal" | "italic";
      source: string;            // CSS local() source
    }>;
  }>;
}
```
