/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { app, BrowserWindow, nativeImage, session, shell } from "electron";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { makeUserNotifier, updateElectronApp } from "update-electron-app";
import { tempPathFor } from "./atomic";
import { externalUrl } from "./external-url";
import { DapiServer } from "./dapi/server";
import { agentChatEndpoint, configureAgentChat, deleteProjectChats, stopAgentChat } from "./agent-chat";
import { cliStatus, installCli, refreshCliShim, uninstallCli } from "./cli-install";
import { applyMcp, healMcpRegistrations, mcpStatus } from "./mcp-install";
import { trackEvent, trackInstall } from "./analytics";
import { setupAppMenu } from "./menu";
import { AppTray } from "./tray";
import { WindowHost } from "./window-host";
import { handleSquirrelEvent } from "./squirrel";
import { mainBridge } from "./main-manager";
import { MAIN_CHANNELS } from "./main-channels";
import {
  compileProject,
  createProject,
  defaultRoot,
  deleteProject,
  duplicateProject,
  getProject,
  initProject,
  pickFolder,
  pickRoot,
  renameProject,
  resolveProject,
  scanProjects,
  unwatchAll,
  listEntries,
  realPathEntry,
  noteContent,
  noteRenamed,
  readConfig,
  readManifest,
  removeEntry,
  statEntry,
  unwatchProject,
  watchProject,
  writeConfig,
  writeManifest,
  writeProject,
} from "./projects";
import type { DeepLinkChannel } from "./main-channels";
import type { LogEntry } from "@diffusionstudio/dapi";

const DEV_URL = "http://localhost:5173";
const WINDOW_IDLE_MS = 10 * 60 * 1000;
const AUTH_PROTOCOL = "diffusion";
const MACOS_CORNER_RADIUS = 18;
const MACOS_BACKDROP = { blur: 80, red: 0.07, green: 0.07, blue: 0.07, alpha: 0.9 };
// Window Controls Overlay on Windows: as tall as the renderer's `h-10` drag
// strip, coloured like the sidebar it sits on (`--sidebar`), with symbols in
// `--muted-foreground` like the other title bar icons. The dark value is that
// token flattened onto the sidebar, since the overlay takes opaque colours.
const WINDOWS_OVERLAY_HEIGHT = 40;
const WINDOWS_OVERLAY_COLORS = {
  dark: { color: "#121212", symbolColor: "#a1a1a1" },
  light: { color: "#f7f7f7", symbolColor: "#737373" },
};

// A Squirrel.Windows install/update/uninstall launch: housekeeping only, the
// app quits on its own. Decided first so nothing below starts a service or
// checks for updates on a launch that is about to end.
const squirrelLaunch = handleSquirrelEvent();

app.setName("Diffusion Studio");
app.commandLine.appendSwitch("enable-blink-features", "CanvasDrawElement");
app.commandLine.appendSwitch("enable-features", "SharedArrayBuffer");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

let setNativeCornerRadius: ((handle: Buffer, radius: number) => void) | null = null;
let setNativeBackdrop:
  | ((handle: Buffer, blur: number, r: number, g: number, b: number, a: number) => void)
  | null = null;

if (process.platform === "darwin") {
  ({ setCornerRadius: setNativeCornerRadius, setBackdrop: setNativeBackdrop } = require(
    join(app.getAppPath(), "dist", "corner_radius.node"),
  ));
}

function applyCornerRadius(radius: number) {
  if (!setNativeCornerRadius || !mainWindow || mainWindow.isDestroyed()) return;
  setNativeCornerRadius(mainWindow.getNativeWindowHandle(), radius);
}

function applyBackdrop() {
  if (!setNativeBackdrop || !mainWindow || mainWindow.isDestroyed()) return;
  const { blur, red, green, blue, alpha } = MACOS_BACKDROP;
  setNativeBackdrop(mainWindow.getNativeWindowHandle(), blur, red, green, blue, alpha);
}

function setColorMode(mode: "dark" | "light") {
  if (process.platform === "darwin" || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setTitleBarOverlay({ ...WINDOWS_OVERLAY_COLORS[mode], height: WINDOWS_OVERLAY_HEIGHT });
}

if (app.isPackaged && !squirrelLaunch) {
  const notifyUser = makeUserNotifier();
  updateElectronApp({
    repo: "diffusionstudio/editor",
    onNotifyUser: function (info) {
      if (windows.visible()) {
        notifyUser(info);
      }
    },
  });
}

const openWrites = new Map<string, { handle: FileHandle; path: string; temp: string; reserved: boolean }>();

let mainWindow: BrowserWindow | null = null;
let lastProject: string | null = null;

const windows = new WindowHost({
  create: createWindow,
  idleMs: WINDOW_IDLE_MS,
  onChange: () => tray.refresh(),
});

const tray = new AppTray({
  visible: () => windows.visible(),
  active: () => windows.active(),
  project: () => lastProject,
  show: () => void windows.show(),
  hide: () => windows.hide(),
});

// Deep links that arrived before the renderer could take them, keyed by the
// channel they belong to so auth and checkout never drain each other's link.
const pendingDeepLinks = new Map<DeepLinkChannel, string>();

// Renderer console mirror, served to the CLI via LOGS_GET. Lives in main so
// it survives reloads and captures everything the devtools console shows
// (page logs, worker logs, uncaught errors) without touching the web bundle.
const LOG_BUFFER_MAX = 2000;
const logBuffer: LogEntry[] = [];

// The docs the MCP instructions point agents at: staged into the bundle by
// scripts/stage-docs.mjs (Contents/Resources/docs) when packaged; the repo's
// own `docs/` in development, so edits show up without a staging step. Null
// when neither exists.
function docsDir(): string | null {
  const dir = app.isPackaged ? join(process.resourcesPath, "docs") : join(app.getAppPath(), "..", "..", "docs");
  return existsSync(dir) ? dir : null;
}

// The MCP server agents and the diffusion CLI talk to. Started once the app is
// ready; renderer tools create the window when there is none.
const dapi = new DapiServer({
  version: app.getVersion(),
  logs: () => logBuffer,
  docsDir: docsDir(),
  window: {
    visible: () => windows.visible(),
    show: () => windows.show(),
    hide: () => windows.hide(),
    acquire: () => windows.acquire(),
    hold: () => windows.hold(),
    lastProject: () => lastProject,
  },
});

function pushLog(level: LogEntry["level"], message: string, source: string) {
  logBuffer.push({ ts: Date.now(), level, message, source });
  if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
}

function captureConsole(window: BrowserWindow) {
  window.webContents.on("console-message", ({ level, message, lineNumber, sourceId }) => {
    pushLog(level, message, sourceId ? `${sourceId}:${lineNumber}` : "");
  });
  window.webContents.on("preload-error", (_event, path, error) => {
    pushLog("error", `Preload error: ${error.message}`, path);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    pushLog("error", `Renderer process gone: ${details.reason} (exit code ${details.exitCode})`, "");
  });
}

function findProtocolUrl(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${AUTH_PROTOCOL}://`)) ?? null;
}

function isHiddenLaunch(argv: string[]): boolean {
  return argv.includes("--hidden");
}

// diffusion://auth/callback → auth, diffusion://checkout/callback → checkout.
function deepLinkChannel(url: string): DeepLinkChannel | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }

  if (host === "auth") return MAIN_CHANNELS.AUTH_CALLBACK;
  if (host === "checkout") return MAIN_CHANNELS.CHECKOUT_CALLBACK;
  return null;
}

function deliverDeepLink(url: string) {
  const channel = deepLinkChannel(url);
  if (!channel) return;

  // A link that arrives before the page can receive it is parked rather than
  // pushed: the renderer's subscription only exists once the component holding
  // it mounts, which is well after did-finish-load. Parked links are handed
  // over by the take* handlers below, which every consumer calls on mount.
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) {
    pendingDeepLinks.set(channel, url);
    return;
  }

  mainBridge.emit(mainWindow, channel, { url });
}

function takePendingDeepLink(channel: DeepLinkChannel): string | null {
  const url = pendingDeepLinks.get(channel) ?? null;
  pendingDeepLinks.delete(channel);
  return url;
}

async function setFileInputFiles(selector: string, absolutePath: string) {
  if (!mainWindow) throw new Error("No main window");
  const wc = mainWindow.webContents;
  // Stay attached between calls — attach/detach dominates the cost of a
  // transfer, and file materialization happens in bursts.
  if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
  const { root } = await wc.debugger.sendCommand("DOM.getDocument");
  const { nodeId } = await wc.debugger.sendCommand("DOM.querySelector", {
    nodeId: root.nodeId,
    selector,
  });
  if (!nodeId) throw new Error(`Selector not found: ${selector}`);
  await wc.debugger.sendCommand("DOM.setFileInputFiles", {
    files: [absolutePath],
    nodeId,
  });
}

// The main window, not shown: WindowHost decides when it is.
function createWindow(): BrowserWindow {

  const options: Electron.BrowserWindowConstructorOptions = {
    show: false,
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(app.getAppPath(), "dist", "preload.js"),
      backgroundThrottling: false,
    },
  }

  if (process.platform === "darwin") {
    options.titleBarStyle = "hiddenInset" as const;
    options.trafficLightPosition = { x: 14, y: 14 };
    options.vibrancy = "sidebar" as const;
    options.backgroundColor = "#00000000";
  }

  if (process.platform === "win32") {
    options.titleBarStyle = "hidden" as const;
    options.titleBarOverlay = { ...WINDOWS_OVERLAY_COLORS.dark, height: WINDOWS_OVERLAY_HEIGHT };
    options.autoHideMenuBar = true;
    options.backgroundColor = WINDOWS_OVERLAY_COLORS.dark.color;

    if (!app.isPackaged) {
      options.icon = join(app.getAppPath(), "assets", "icon-dev.png");
    }
  }

  mainWindow = new BrowserWindow(options);

  captureConsole(mainWindow);

  applyCornerRadius(MACOS_CORNER_RADIUS);
  applyBackdrop();

  mainWindow.once("ready-to-show", () => {
    applyCornerRadius(MACOS_CORNER_RADIUS);
    applyBackdrop();
  });

  mainWindow.on("show", () => {
    applyCornerRadius(MACOS_CORNER_RADIUS);
    applyBackdrop();
  });

  mainWindow.on("enter-full-screen", () => {
    applyCornerRadius(0);
    mainBridge.emit(mainWindow, MAIN_CHANNELS.WINDOW_FULLSCREEN_CHANGE, { fullscreen: true });
  });
  mainWindow.on("leave-full-screen", () => {
    applyCornerRadius(MACOS_CORNER_RADIUS);
    mainBridge.emit(mainWindow, MAIN_CHANNELS.WINDOW_FULLSCREEN_CHANGE, { fullscreen: false });
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    unwatchAll();
  });

  if (!app.isPackaged) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(join(app.getAppPath(), "web", "index.html"));
  }

  return mainWindow;
}

if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(AUTH_PROTOCOL, process.execPath, [
    join(process.cwd(), process.argv[1]!),
  ]);
} else {
  app.setAsDefaultProtocolClient(AUTH_PROTOCOL);
}

if (squirrelLaunch) {
  // Update.exe is at work; handleSquirrelEvent quits the app when it is done.
} else if (app.requestSingleInstanceLock()) {
  if (isHiddenLaunch(process.argv)) {
    app.dock?.hide();
  }

  app.on("second-instance", (_event, argv) => {
    const url = findProtocolUrl(argv);
    if (url) {
      deliverDeepLink(url);
    }
    if (!isHiddenLaunch(argv)) {
      windows.show();
    }
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    deliverDeepLink(url);
    windows.show();
  });

  mainBridge.handle(MAIN_CHANNELS.APP_OPEN_EXTERNAL, ({ url }) => {
    const external = externalUrl(url);
    if (!external) {
      // The scheme alone, so a token in a rejected link stays out of the log.
      const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1] ?? "(none)";
      console.error(`[main] refused to open an external "${scheme}" link`);
      return;
    }
    return shell.openExternal(external);
  });
  mainBridge.handle(MAIN_CHANNELS.APP_SHOW_IN_FOLDER, ({ path }) => shell.showItemInFolder(path));
  mainBridge.handle(MAIN_CHANNELS.ANALYTICS_TRACK, ({ event, data }) => trackEvent(event, data));
  mainBridge.handle(MAIN_CHANNELS.AUTH_GET_PENDING_CALLBACK, () =>
    takePendingDeepLink(MAIN_CHANNELS.AUTH_CALLBACK),
  );
  mainBridge.handle(MAIN_CHANNELS.CHECKOUT_GET_PENDING_CALLBACK, () =>
    takePendingDeepLink(MAIN_CHANNELS.CHECKOUT_CALLBACK),
  );
  mainBridge.handle(MAIN_CHANNELS.WINDOW_IS_FULLSCREEN, () => mainWindow?.isFullScreen() ?? false);
  mainBridge.handle(MAIN_CHANNELS.WINDOW_SET_COLOR_MODE, ({ mode }) => setColorMode(mode));
  mainBridge.handle(MAIN_CHANNELS.WINDOW_SET_BUSY, ({ busy }) => windows.setBusy(busy));
  mainBridge.handle(MAIN_CHANNELS.WINDOW_SHOW, () => windows.show());
  mainBridge.handle(MAIN_CHANNELS.WINDOW_CAPTURE, async () => {
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error("No main window");
    const image = await mainWindow.webContents.capturePage(undefined, { stayHidden: true });
    const { width, height } = image.getSize();
    const png = image.toPNG();
    // A plain Uint8Array over the PNG, so the renderer sees bytes and not a Buffer.
    return { png: new Uint8Array(png.buffer, png.byteOffset, png.byteLength), width, height };
  });
  mainBridge.handle(MAIN_CHANNELS.LOGS_GET, () => logBuffer);
  mainBridge.handle(MAIN_CHANNELS.AGENT_CHAT_ENDPOINT, () => agentChatEndpoint());
  mainBridge.handle(MAIN_CHANNELS.MCP_STATUS, () => mcpStatus());
  mainBridge.handle(MAIN_CHANNELS.MCP_APPLY, (request) => applyMcp(request));
  mainBridge.handle(MAIN_CHANNELS.CLI_STATUS, () => cliStatus());
  mainBridge.handle(MAIN_CHANNELS.CLI_INSTALL, () => installCli());
  mainBridge.handle(MAIN_CHANNELS.CLI_UNINSTALL, () => uninstallCli());
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_PICK_ROOT, () => pickRoot(mainWindow));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_PICK_FOLDER, () => pickFolder(mainWindow));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_DEFAULT_ROOT, () => defaultRoot(mainWindow));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_SCAN, ({ root }) => scanProjects(root));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_GET, ({ dir }) => getProject(dir));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_INIT, ({ dir }) => initProject(mainWindow, dir));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_RESOLVE, ({ dir }) => resolveProject(dir));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_CREATE, ({ root, displayName }) =>
    createProject(root, displayName),
  );
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_RENAME, ({ dir, displayName }) => renameProject(dir, displayName));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_DUPLICATE, ({ dir }) => duplicateProject(dir));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_DELETE, ({ dir }) => deleteProject(dir).then(deleteProjectChats));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_COMPILE, ({ dir }) => compileProject(dir));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_WRITE, ({ dir, edits }) => writeProject(dir, edits));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_WATCH, ({ dir }, event) => {
    lastProject = dir;
    tray.refresh();
    watchProject(BrowserWindow.fromWebContents(event.sender), dir);
  });
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_UNWATCH, ({ dir }) => {
    if (lastProject === dir) {
      lastProject = null;
      tray.refresh();
    }
    unwatchProject(dir);
  });
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_MANIFEST_READ, ({ dir }) => readManifest(dir));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_MANIFEST_WRITE, ({ dir, manifest }) => writeManifest(dir, manifest));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_CONFIG_READ, ({ dir }) => readConfig(dir));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_CONFIG_WRITE, ({ dir, config }) => writeConfig(dir, config));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_FS_LIST, ({ dir, source }) => listEntries(dir, source));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_FS_STAT, ({ dir, source }) => statEntry(dir, source));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_FS_REMOVE, ({ dir, path }) => removeEntry(dir, path));
  mainBridge.handle(MAIN_CHANNELS.PROJECTS_FS_REAL_PATH, ({ dir, source }) => realPathEntry(dir, source));
  mainBridge.handle(MAIN_CHANNELS.FILE_TRANSFER, ({ selector, absolutePath }) =>
    setFileInputFiles(selector, absolutePath),
  );

  mainBridge.handle(MAIN_CHANNELS.FILE_WRITE_OPEN, async ({ path, exclusive }) => {
    await mkdir(dirname(path), { recursive: true });

    // `exclusive` means the name must be free, so it is taken now rather than
    // at the rename below — the empty file that reserves it is renamed over
    // when the write finishes, and removed when it is abandoned.
    if (exclusive) {
      noteContent(path, "");
      await (await open(path, "wx")).close();
    }

    // The bytes go to a temp file beside the destination and are renamed into
    // place once they are whole. Nothing ever sees half an asset — not the
    // watcher, not a scan of the library, not an import — so there is no
    // window anyone has to be kept out of.
    const temp = tempPathFor(path);
    const handle = await open(temp, "wx");
    const id = randomUUID();
    openWrites.set(id, { handle, path, temp, reserved: exclusive === true });
    return { id };
  });

  mainBridge.handle(MAIN_CHANNELS.FILE_WRITE_CHUNK, async ({ id, data, position }) => {
    const entry = openWrites.get(id);
    if (!entry) throw new Error(`No open file for write id ${id}`);
    await entry.handle.write(data, 0, data.byteLength, position);
  });

  mainBridge.handle(MAIN_CHANNELS.FILE_WRITE_CLOSE, async ({ id }) => {
    const entry = openWrites.get(id);
    if (!entry) return;
    openWrites.delete(id);
    try {
      await entry.handle.close();
      // Claimed before the rename, which is the first and only moment the
      // destination changes (see `noteRenamed`).
      await noteRenamed(entry.temp, entry.path);
      await rename(entry.temp, entry.path);
    } catch (error) {
      await unlink(entry.temp).catch(() => { });
      throw error;
    }
  });

  // Abort: close the fd and drop the temp file (cancel / error cleanup). The
  // destination is left alone — an abandoned write never reached it — bar the
  // name an `exclusive` open reserved, which is given back.
  mainBridge.handle(MAIN_CHANNELS.FILE_WRITE_ABORT, async ({ id }) => {
    const entry = openWrites.get(id);
    if (!entry) return;
    openWrites.delete(id);
    try {
      await entry.handle.close();
    } finally {
      await unlink(entry.temp).catch(() => { });
      if (entry.reserved) {
        noteContent(entry.path, null);
        await unlink(entry.path).catch(() => { });
      }
    }
  });

  app.whenReady().then(() => {
    if (!app.isPackaged && process.platform === "darwin") {
      const devIcon = nativeImage.createFromPath(join(app.getAppPath(), "assets", "icon-dev.png"));
      if (!devIcon.isEmpty()) app.dock?.setIcon(devIcon);
    }

    setupAppMenu();
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(true));
    session.defaultSession.setPermissionCheckHandler(() => true);
    session.defaultSession.setDevicePermissionHandler(() => true);

    const url = findProtocolUrl(process.argv);
    if (url) deliverDeepLink(url);

    dapi.start();
    // The chat's sessions get the MCP server by URL.
    dapi.mcpUrl().then((url) =>
      configureAgentChat({
        dataDir: join(app.getPath("userData"), "agent-chat"),
        mcpUrl: url,
        version: app.getVersion(),
      }),
    );
    refreshCliShim();
    healMcpRegistrations();
    trackInstall();
    tray.start();

    // Opened by a person (Finder, Dock, Start menu): show the editor
    if (!isHiddenLaunch(process.argv)) {
      windows.show();
    }
  });

  app.on("before-quit", () => {
    unwatchAll();
    stopAgentChat();
    dapi.stop();
    tray.destroy();
  });

  // No window is no reason to quit: the app keeps serving agents from the
  // tray, and the window is destroyed whenever it idles out. Only Quit ends it.
  app.on("window-all-closed", () => { });

  // The Dock icon, or launching the app again while it runs.
  app.on("activate", () => windows.show());
} else {
  app.quit();
}
