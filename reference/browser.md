# `dapi browser`

Starts a local, read-only browser companion for one project. Electron is still
the host: its hidden renderer owns the open project, compile/watch loop, DAPI,
filesystem, export, and AI behavior. The browser is only another constrained
renderer of the same `apps/web` build and route/component tree.

The command never launches the operating system's default browser. An agent or
harness opens the returned URL in its Codex built-in browser.

## Start

```sh
dapi browser ./my-project
```

The command ensures Diffusion Studio is running with its window hidden, opens
the project through the existing DAPI, waits until that renderer reports the
same open folder, starts a random loopback listener, and prints one JSON object:

```ts
{
  active: true;
  sessionId: string;
  origin: `http://127.0.0.1:${number}`;
  url: string; // one-time capability is in the fragment and is cleared on authentication
  project: { id: string; name: string; displayName: string };
  rendererConnected: boolean;
  hostWindowVisible: false;
  revision: number;
  bundleHash: string; // SHA-256 of the exact canonical compiled bundle
  canonicalCompiled: { sessionId: string; revision: number; bundleHash: string };
  hostApplied: { sessionId: string; revision: number; bundleHash: string };
  browserApplied?: { sessionId: string; revision: number; bundleHash: string };
  lifecycle:
    | "awaiting-renderer"
    | "awaiting-host-apply"
    | "awaiting-browser-apply"
    | "ready"
    | "disconnected-fresh-session-required"
    | "failed";
  egressAttempts: number;
  capabilities: {
    readOnly: true;
    browserDapi: false;
    cloudAi: false;
    persistentEdits: false;
    htmlPaint: false;
    media: "unsupported-phase-a";
    webgpu: "browser-dependent";
    fonts: "browser-dependent";
    trustedProjectCode: true;
  };
  humanStep: string;
}
```

Treat `url` as a one-time local secret. It is accepted by only one renderer,
is never sent in an HTTP request, and cannot be reused after authentication.

Every start assigns a fresh session identity, resets the hidden renderer to a non-project route, arms one bounded
capture for the requested project root, and then opens that project through the
unchanged DAPI route. The resulting canonical compile is released as soon as
the start consumes it (or after 30 seconds). Normal desktop compiles are not
cached by companion code, and stop→start of the same project therefore obtains
a fresh renderer compile instead of reusing a prior session's bundle.

Readiness has three distinct stages. Main records `canonicalCompiled`; the
hidden Electron `EditorPage` acknowledges only after the reconciler mounted the
exact session/revision/hash; only then does main relay the snapshot to the
browser, whose own `EditorPage` returns the same exact applied identity. Status
is `ready` only when all three match. Offline DAPI capture/export uses the same
compiler but is not a surface mount and therefore cannot advance these stages.

Phase A is code-native only. Browser media materialization and File System
Access handles are explicitly unsupported: there is no path, byte, download,
Range, or speculative media bridge. Use the authoritative Electron/DAPI path
for media projects until a separately proven disk-backed source seam exists.

## Observe and stop

```sh
dapi browser --status
dapi browser --logs
dapi browser --stop
```

`--status` reports renderer connection, hidden-host visibility/local-only mode,
the three applied identities, lifecycle, and blocked egress-attempt count.
`--logs` returns the bounded structured log ring, with sequence ids, redacted
semantic playback/scrub/source events, and distinct compile/apply failures.
`--stop` closes the project watcher, renderer socket, WebSocket server, and
loopback listener, removes the host network guard, and restores the renderer's
pre-companion route/mode. It leaves Electron and DAPI healthy. Closing or
reloading the browser tab consumes no new authority: the stale shell says
`Disconnected; start a fresh browser companion session`, status reports
`disconnected-fresh-session-required`, and a fresh start supplies a new
session, port, and one-time capability.

## Security and capability boundary

- The listener always binds to `127.0.0.1` on a random port and requires the
  exact HTTP/WebSocket Origin.
- Hidden Electron and browser execute the exact same packaged `apps/web` file
  tree. Host and shell exchange protocol version, schema hash, app version, and
  the hash of that complete served build. Any mismatch fails closed; there is
  no copied shell or duplicate editor UI.
- No Electron desktop bridge, DAPI router, write/delete operation, external
  opener, export, AI endpoint, Supabase session, checkout, analytics, or Sentry
  transport is exposed to the browser. The app-owned local-only profile also
  suppresses remote font discovery and exposes only bundled/local fallback
  families.
- The relay contains only the canonical compiled bundle, narrow project
  identity, revision/build linkage, and fixed capability description. It does
  not read or send `assets.yml`, project config, project roots, or file paths;
  the companion initializes its asset library from an explicit empty manifest
  and its project config from `null`.
- The loopback server's CSP and the renderer guards reliably deny and record
  non-loopback `fetch`, XHR, WebSocket, EventSource, Worker/SharedWorker,
  `importScripts`, beacon, `window.open`, and image/media/source/link/script/
  frame/form/font URL attempts. The hidden Electron host separately blocks
  non-loopback requests while companion mode is active. Network audit evidence
  must distinguish attempted-and-blocked activity from zero attempts.
- Scene/frame export controls are omitted from the companion File menu and
  inspector. Cmd/Ctrl-E is inert, and both action boundaries reject before a
  save picker, encoder render, frame snapshot, or download can begin. Electron
  UI and DAPI export continue through their existing paths.
- Project JSX and Babel plugins remain explicitly trusted code: Electron's
  canonical compiler evaluates them, and the browser reconciler evaluates the
  compiled bundle with `new Function` in the app realm. Companion identity is
  captured once and its public bootstrap object is frozen/non-writable so
  accidental or DevTools tampering cannot restore authoring authority.
  This is not a sandbox or containment boundary for an actively malicious
  trusted project. In particular, same-realm top-level navigation cannot be
  guaranteed against such code without a separate sandbox/browser policy; the
  prototype does not make that claim.

## Phase A limits

- Persistent and browser-local document edits are disabled. Inspector fields,
  font selection, canvas transform, clip trim/drag, layer/keyframe actions,
  mutation shortcuts/drop paths, and scene/frame export are disabled or inert.
  Selection, inspection, layer expansion, Move/Hand/pan, zoom, playback, and
  scrub remain local view state. Use the Electron-owned DAPI or edit source
  files on disk; the companion reloads only after Electron mounts and
  acknowledges the new canonical bundle.
- Diffusion AI generation, captions without a local transcript source,
  transcription/listening, background removal, upscale, and add-audio are
  disabled in zero-credit/local-only mode. Browser media is not supported in
  this phase; local inputs remain available only to the authoritative desktop
  path.
- `<html>`/`htmlPaint` fails closed because ordinary Chromium lacks the
  experimental `CanvasDrawElement` API used by Electron. WebGPU, shader, and
  local-font behavior remains browser-dependent.
- There is no browser DAPI or screenshot claim, and no large-file or
  multi-gigabyte streaming claim. A future user-granted disk-backed handle or
  URL/byte-source seam needs a separate bounded-memory proof.
- Full-parity Linux/Windows Electron packaging is a separate track. If hiding
  a renderer window is not reliable on a platform, the host must use the
  documented deterministic minimized fallback before claiming the same UX.

Reusing `apps/web` directly minimizes drift and automatically inherits most UI
changes. Truly maintenance-free operation requires this seam to merge upstream;
until then, a thin fork patch can still require rebasing as host interfaces
change.

The 30-second acceptance project is a comprehensive representative proof of
the supported macOS Phase A flow. It is not exhaustive editor parity, a
malicious-code sandbox proof, or Linux/Windows packaging evidence.
