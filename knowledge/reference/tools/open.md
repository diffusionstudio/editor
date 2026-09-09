# open

Open a folder as a project in the running app, creating the project files if the folder is not one yet, and show it in the editor. Returns the project's id, display name, and folder. Run this once before tools that need an open project (capture, check, export, context, and library paths in media tools).

| | |
| --- | --- |
| MCP tool | `open` |
| CLI | `dapi open [path] [options]` |

## Input

| Field | Type | CLI | Description |
| --- | --- | --- | --- |
| `dir` | `string`, required | `[path]` | absolute path of the project folder to open or create |
| — | | `-b, --background` | launch or keep the app in the background, without raising a window (CLI only) |

## What opening writes

The folder may live anywhere on disk, and does not have to be a project yet. Opening is what makes it one, writing as little as that takes:

- a missing folder is created;
- a folder with no entry file (package.json `main`, or `index.tsx` and friends) gains an `index.tsx` holding an empty stage.

Nothing else is written — no package.json, tsconfig, README, or manifest. A project is its JSX; the rest of the scaffold appears lazily, each piece when something first needs it. A folder that is already a project is opened untouched, wherever it lives.

The app remembers the folder, so the project reopens across app relaunches and stays addressable by folder name or project id.

## From a shell

`dapi open` is also how the app starts: it launches Diffusion Studio (macOS) or surfaces the running instance, then, given a path, calls the tool. With no path it only makes sure the app is up, printing nothing and exiting `0` once the app answers. Relative paths resolve against the shell's working directory. `--background` launches or keeps the app without raising a window — the way to drive the editor headless.

Over MCP the app is already running, since that is what the connection is to; the tool only opens the folder, and `dir` must be absolute.

## Output

The opened project:

```ts
{
  id:   string;   // package.json `projectId`; "" until the project has a record
  name: string;   // display name (falls back to the folder name)
  dir:  string;   // absolute project folder, as opened
}
```

## Errors

- The path exists but is not a folder.
- From a shell off macOS, the app cannot be launched; the command then requires it to already be running.
