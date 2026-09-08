# `dapi report <title>`

Reports a bug in `dapi` itself or in the app behind it: a command that errors, contradicts this reference, or returns something it shouldn't. Bundles the description with diagnostics (dapi version, platform, node version, the app's recent console output) and files it as a GitHub issue on [diffusionstudio/editor](https://github.com/diffusionstudio/editor/issues), printing the URL of the created issue.

The issue is submitted immediately, in the background, with no review step: the command returns once the issue exists. Filing goes through the [`gh`](https://cli.github.com) CLI, which must be installed and authenticated (`gh auth login`); without it the command exits `1` and files nothing.

This is for defects in the tooling, not for problems inside a project: a composition that looks wrong, a node in the wrong place, or a generation that missed the prompt are editing problems, not reported here.

Does not require the app to be running. If the app is down or unreachable, the report records that instead of failing, since that is often the bug being reported.

## Arguments

- `<title>`: one-line summary of the problem, used as the issue title.

## Options

- `-b, --body <text>`: what happened, in markdown: what you expected, what you got, and anything the diagnostics won't show.
- `-c, --command <cmd...>`: the `dapi` command(s) that reproduce it, in order. Repeatable (`-c "dapi context" -c "dapi capture intro"`); rendered as a shell block under `## Repro`.
- `--logs <n>`: trailing app log entries to attach (default: 50). `--logs 0` omits the section, and then the app is not contacted at all.

## Output

One JSON object:

```ts
{
  url: string  // the created github.com/diffusionstudio/editor issue
}
```

## Issue layout

The title is the issue title; the body is assembled from the options and the diagnostics:

````md
<body>

## Repro

```sh
dapi capture intro
```

## Environment

| | |
| --- | --- |
| dapi | 0.129.0 |
| platform | darwin 25.5.0 (arm64) |
| node | v20.19.0 |
| app | running |

## App logs

```
19:37:17.538 [info] Finalizing file  (…)
```
````

The `app` row reads `running`, `not running`, `not checked` (with `--logs 0`), or the reason it was unreachable.

## Notes

- Attached logs are the same entries [`logs`](./logs.md) prints, and can contain project names, file paths, and prompt text. They go straight to a public issue: pass `--logs 0`, or check what [`logs`](./logs.md) currently holds, before reporting from a sensitive project.
- Exits non-zero on an empty title, an invalid `--logs`, a missing `gh`, or a failure from `gh` (not authenticated, no access to the repo); the message from `gh` is passed through.
- `dapi issue` is an alias of this command.
