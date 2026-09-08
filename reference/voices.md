# `dapi voices`

Lists the speech voices available for `generate.voice` declarations (see [jsx/generate.md](./jsx/generate.md)).

## Input

None.

## Output

One JSON object:

```ts
{ voices: Array<{ id: string; label: string; description: string }> }
```
