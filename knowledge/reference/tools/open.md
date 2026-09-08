# `dapi open [path]`

Launches Diffusion Studio — or surfaces the running instance — and, given a
path, opens that folder as a project. The first command of the core loop:
`open`, then mount, then render.

The folder may live anywhere on disk, and does not have to be a project yet.
Opening is what makes it one, writing as little as that takes:

- a missing folder is created;
- a folder with no entry file (package.json `main`, or `index.tsx` and
  friends) gains an `index.tsx` holding an empty stage.

Nothing else is written — no package.json, tsconfig, README, or manifest. A
project is its JSX; the rest of the scaffold appears lazily, each piece when
something first needs it. A folder that is already a project is opened
untouched, wherever it lives.

The app remembers the folder, so the project reopens across app relaunches
and stays addressable by folder name or project id.

## Input

- `[path]`: project folder to open or create (optional; with no path the
  command just makes sure the app is up). Relative paths resolve against the
  shell's working directory.
- `-b, --background`: launch or keep the app in the background, without
  raising a window. The way to drive the editor headless.

## Output

With a path, the opened project as one JSON object:

```ts
{
  id:   string;   // package.json `projectId`; "" until the project has a record
  name: string;   // display name (falls back to the folder name)
  dir:  string;   // absolute project folder, as opened
}
```

With no path, nothing: exit code `0` says the app is up.

## Errors

- The path exists but is not a folder.
- Off macOS, the app cannot be launched; the command then requires it to
  already be running.
