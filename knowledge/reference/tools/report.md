# report

Report a bug in dapi or the app itself. Files a GitHub issue on diffusionstudio/editor with diagnostics attached (dapi version, platform, recent app logs) and returns its URL. Submits immediately and publicly through the gh CLI, which must be installed and authenticated; there is no review step, so only report real defects and check the attached logs for anything private.

| | |
| --- | --- |
| MCP tool | `report` |
| CLI | `dapi report <title> [options]` |
| CLI aliases | `dapi issue` |

## Input

| Field | Type | CLI | Description |
| --- | --- | --- | --- |
| `title` | `string`, required | `<title>` | one-line summary of the problem |
| `body` | `string` | `-b, --body <text>` | what happened, in markdown: expected vs actual, and anything the diagnostics won't show |
| `commands` | `string[]` | `-c, --commands <cmd...>` | the dapi commands or tool calls that reproduce it, in order |
| `logs` | `integer` | `--logs <n>` | trailing app log entries to attach (0 to omit; default: 50) |

For a tool that errors, contradicts this reference, or returns something it shouldn't. The description is bundled with diagnostics (app version, platform, Electron version, the app's recent console output) and filed as a GitHub issue on [diffusionstudio/editor](https://github.com/diffusionstudio/editor/issues).

The issue is submitted immediately, with no review step: the call returns once the issue exists. Filing goes through the [`gh`](https://cli.github.com) CLI, which must be installed and authenticated (`gh auth login`) on this machine; without it nothing is filed. It runs in the app's main process, so no project needs to be open.

This is for defects in the tooling, not for problems inside a project: a composition that looks wrong, a node in the wrong place, or a generation that missed the prompt are editing problems, not reported here.

## Output

One JSON object:

```ts
{
  url: string  // the created github.com/diffusionstudio/editor issue
}
```

## Issue layout

The title is the issue title; the body is assembled from the fields and the diagnostics:

````md
<body>

## Repro

```sh
dapi capture intro
```

## Environment

| | |
| --- | --- |
| app | 0.204.1 |
| platform | darwin 25.5.0 (arm64) |
| electron | 38.2.0 |

## App logs

```
19:37:17.538 [info] Finalizing file  (…)
```
````

`commands` are rendered as a shell block under `## Repro`, in the order given; from a shell, `-c` is repeatable (`-c "dapi context" -c "dapi capture intro"`). `logs: 0` omits the log section.

## Notes

- Attached logs are the same entries [`logs`](./logs.md) returns, and can contain project names, file paths, and prompt text. They go straight to a public issue: pass `logs: 0`, or check what [`logs`](./logs.md) currently holds, before reporting from a sensitive project.

## Errors

Fails on an empty title, a `logs` value below 0, a missing `gh`, or a failure from `gh` (not authenticated, no access to the repo); the message from `gh` is passed through.
