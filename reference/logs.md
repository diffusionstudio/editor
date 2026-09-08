# `dapi logs`

Prints recent console output from the running app: everything the devtools console shows, including page logs, worker logs, uncaught errors, and Chromium warnings. Oldest first. The app buffers the last 2000 entries in its main process, so the log survives page reloads and project switches; use this instead of relaunching with `ELECTRON_ENABLE_LOGGING=1` to see renderer-side errors.

## Options

- `-n, --tail <n>`: output only the last `<n>` entries (positive integer)
- `-l, --level <level>`: minimum level to include: `"debug"`, `"info"`, `"warning"`, or `"error"`

## Output

One JSON object, the entries oldest first:

```ts
{
  entries: Array<{
    ts:      number;   // unix time, milliseconds
    level:   "debug" | "info" | "warning" | "error";
    message: string;
    source:  string;   // file:line the entry came from (a URL in dev builds); empty for synthetic entries such as renderer crashes and preload errors
  }>;
}
```

## Errors

Exits non-zero on an invalid `--tail` or `--level`, or if the app is not running.
