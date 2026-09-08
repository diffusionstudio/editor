# `dapi whoami`

Prints the authenticated account, or `null` if signed out.

## Input

None.

## Output

One JSON object:

```ts
{ user: { id: string; email?: string } | null }
```
