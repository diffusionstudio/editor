/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Where the user's binaries are, and the environment they get. A Finder- or
// Dock-launched app inherits launchd's minimal PATH, so the login shell's is
// read once at start and put in front; Windows GUI apps already carry the
// user's PATH. Children never see Electron's own variables.

import { execFile, spawn } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

import type { ChildProcess } from "node:child_process";

export type HostEnv = {
  /** Hydrated environment for children: login-shell PATH, no ELECTRON_* / NODE_OPTIONS. */
  env: Record<string, string>;
  /** Directories searched after PATH. */
  extraDirs: string[];
};

const SHELL_TIMEOUT_MS = 5000;
const IS_WINDOWS = process.platform === "win32";

/** Variables the app's own process carries that a user's CLI must not inherit. */
function stripElectron(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (key.startsWith("ELECTRON_") || key === "NODE_OPTIONS" || key === "ORIGINAL_XDG_CURRENT_DESKTOP") continue;
    out[key] = value;
  }
  return out;
}

function candidateShells(): string[] {
  const shells: string[] = [];
  const push = (shell: string | undefined) => {
    if (shell && !shells.includes(shell) && existsSync(shell)) shells.push(shell);
  };
  push(process.env.SHELL);
  try {
    push(userInfo().shell ?? undefined);
  } catch {
    // No passwd entry: the fallbacks below cover it.
  }
  push("/bin/zsh");
  push("/bin/bash");
  return shells;
}

/** The login shell's PATH, or null when no shell answered in time. */
function loginShellPath(shell: string): Promise<string | null> {
  return new Promise((resolvePath) => {
    const child = execFile(
      shell,
      ["-ilc", "printf __S__; printenv PATH; printf __E__"],
      { timeout: SHELL_TIMEOUT_MS, encoding: "utf8", env: process.env, windowsHide: true },
      (error, stdout) => {
        if (error) return resolvePath(null);
        const match = /__S__([\s\S]*?)__E__/.exec(stdout);
        const path = match?.[1]?.trim();
        resolvePath(path ? path : null);
      },
    );
    child.on("error", () => resolvePath(null));
  });
}

export function knownDirs(): string[] {
  const home = homedir();
  if (IS_WINDOWS) {
    const dirs = [
      process.env.APPDATA ? join(process.env.APPDATA, "npm") : null,
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs") : null,
      join(home, ".local", "bin"),
      join(home, ".claude", "local"),
    ];
    return dirs.filter((dir): dir is string => !!dir);
  }
  return [join(home, ".local", "bin"), join(home, ".claude", "local"), "/opt/homebrew/bin", "/usr/local/bin"];
}

/** Runs once at host start; probes await it. Never throws. */
export async function hydrateEnv(): Promise<HostEnv> {
  const env = stripElectron(process.env);
  if (!IS_WINDOWS) {
    for (const shell of candidateShells()) {
      const path = await loginShellPath(shell);
      if (path) {
        const current = env.PATH ?? "";
        const merged = [...path.split(delimiter), ...current.split(delimiter)].filter(Boolean);
        env.PATH = [...new Set(merged)].join(delimiter);
        break;
      }
    }
    if (!env.PATH) env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
  }
  return { env, extraDirs: knownDirs() };
}

/** The env without hydration: for tests and for a host that has not finished starting. */
export function inheritedEnv(): HostEnv {
  return { env: stripElectron(process.env), extraDirs: knownDirs() };
}

function isExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (!IS_WINDOWS) accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * `which`, over the hydrated PATH and then the known install dirs. On Windows
 * the PATHEXT variants are tried, so `claude.cmd` and `codex.exe` are found.
 */
export function which(name: string, host: HostEnv): string | null {
  const dirs = [...(host.env.PATH ?? "").split(delimiter).filter(Boolean), ...host.extraDirs];
  const names = IS_WINDOWS
    ? [name, ...(host.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map((ext) => name + ext.toLowerCase())]
    : [name];
  for (const dir of dirs) {
    for (const candidate of names) {
      const path = join(dir, candidate);
      if (isExecutable(path)) return path;
    }
  }
  return null;
}

/**
 * Where a harness binary is: an explicit override (`DIFFUSION_CLAUDE_PATH`,
 * `DIFFUSION_CODEX_PATH`, `DIFFUSION_OPENCODE_PATH`), else `which`.
 */
export function resolveBinary(name: "claude" | "codex" | "opencode", host: HostEnv): string | null {
  const override = host.env[`DIFFUSION_${name.toUpperCase()}_PATH`] ?? process.env[`DIFFUSION_${name.toUpperCase()}_PATH`];
  if (override && isExecutable(override)) return override;
  return which(name, host);
}

/**
 * An npm `.cmd` shim on Windows cannot be spawned by the Agent SDK (EINVAL);
 * followed to the `cli.js` it wraps, which the SDK runs with node. Anything
 * else — the native `claude.exe`, a POSIX path — is returned as is.
 */
export function resolveClaudeExecutable(path: string): string {
  if (!IS_WINDOWS || !/\.cmd$/i.test(path)) return path;
  const dir = dirname(path);
  const candidates = [
    join(dir, "node_modules", "@anthropic-ai", "claude-code", "cli.js"),
    resolve(dir, "..", "lib", "node_modules", "@anthropic-ai", "claude-code", "cli.js"),
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  // A shim of another shape: read the target out of it.
  try {
    const shim = readFileSync(path, "utf8");
    const match = /"%dp0%\\([^"]+cli\.js)"/i.exec(shim) ?? /"%~dp0\\([^"]+cli\.js)"/i.exec(shim);
    if (match) {
      const target = resolve(dir, match[1]!);
      if (existsSync(target)) return target;
    }
  } catch {
    // Fall through: the SDK's own error will say what went wrong.
  }
  return path;
}

/** Whether spawning `path` needs `shell: true` (Windows `.cmd` / `.bat`). */
export function needsShell(path: string): boolean {
  return IS_WINDOWS && /\.(cmd|bat)$/i.test(path);
}

/** Quotes an argument for `shell: true` on Windows. Ours are constant; this keeps them so. */
export function quoteArg(arg: string): string {
  if (!IS_WINDOWS) return arg;
  return /^[\w./:=@\\-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`;
}

/**
 * Runs a binary once and returns stdout. Null when it could not run or said
 * nothing; what it printed otherwise, even on a non-zero exit — `claude auth
 * status` exits 1 while it reports being signed out.
 */
export function runOnce(path: string, args: string[], host: HostEnv, timeoutMs = 10_000): Promise<string | null> {
  return new Promise((resolveOutput) => {
    const child = execFile(
      needsShell(path) ? `"${path}"` : path,
      args.map(quoteArg),
      { timeout: timeoutMs, encoding: "utf8", env: host.env, windowsHide: true, shell: needsShell(path) },
      (error, stdout) => resolveOutput(error && !stdout.trim() ? null : stdout),
    );
    child.on("error", () => resolveOutput(null));
  });
}

/** The version in a `--version` line: "2.1.236 (Claude Code)" → "2.1.236". */
export function parseVersion(output: string | null): string | undefined {
  if (!output) return undefined;
  return /(\d+\.\d+\.\d+)/.exec(output)?.[1];
}

/** Semver-ish compare: negative when `a` is older than `b`. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Ends a child and everything under it. POSIX: SIGTERM, then SIGKILL after
 * 2 s. Windows: `taskkill /T /F`, which is what reaches a tree started with
 * `shell: true`.
 */
export function killTree(child: ChildProcess, graceMs = 2000): Promise<void> {
  return new Promise((done) => {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) return done();
    const finish = () => {
      clearTimeout(timer);
      done();
    };
    child.once("exit", finish);
    const timer = setTimeout(() => {
      try {
        if (IS_WINDOWS) return;
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
      finish();
    }, graceMs);
    try {
      if (IS_WINDOWS) {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", finish);
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      finish();
    }
  });
}
