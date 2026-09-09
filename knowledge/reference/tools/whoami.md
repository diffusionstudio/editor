# whoami

Report the authenticated account, or null if signed out.

| | |
| --- | --- |
| MCP tool | `whoami` |
| CLI | `dapi whoami` |

## Input

None.

## Output

One JSON object:

```ts
{ user: { id: string; email?: string } | null }
```
