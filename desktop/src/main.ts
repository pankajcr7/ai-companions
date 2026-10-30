import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, Menu, powerMonitor, session, shell } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { APP_URL } from "./config";
import { type LinkInfo, SyncManager } from "./sync/manager";

const ORIGIN = new URL(APP_URL).origin;
const OFFLINE_PAGE = path.join(__dirname, "..", "static", "offline.html");
const OFFLINE_URL = pathToFileURL(OFFLINE_PAGE).href;
const IDLE_SECONDS = 15 * 60;

if (process.env.AGENT_COMPANY_DATA) app.setPath("userData", process.env.AGENT_COMPANY_DATA);
// The user agent Chrome itself sends: Google refuses sign-in from browsers that name themselves embedded.
app.userAgentFallback = `Mozilla/5.0 (${process.platform === "darwin" ? "Macintosh; Intel Mac OS X 10_15_7" : "Windows NT 10.0; Win64; x64"}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome.split(".")[0]}.0.0.0 Safari/537.36`;

const sameSite = (url: string) => URL.canParse(url) && new URL(url).origin === ORIGIN;
const signIn = (url: string) => URL.canParse(url) && new URL(url).protocol === "https:" && /(^|\.)google\.com$/.test(new URL(url).hostname);
const openOutside = (url: string) => {
  if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
};

let win: BrowserWindow | null = null;
const picked = new Set<string>();

const manager = new SyncManager({
  file: path.join(app.getPath("userData"), "sync.json"),
  baseUrl: APP_URL,
  cookie: async () => (await session.defaultSession.cookies.get({ url: APP_URL })).map((c) => `${c.name}=${c.value}`).join("; "),
  trash: (abs) => shell.trashItem(abs),
  onStatus: (projectId, status) => {
    if (win && (sameSite(win.webContents.getURL()) || win.webContents.getURL() === OFFLINE_URL)) win.webContents.send("agent:status", projectId, status);
  },
});

let lastRound = 0;
const syncNow = () => {
  lastRound = Date.now();
  void manager.syncAll();
};

/** Only the site's own top-level pages and the bundled offline page reach the computer. */
const trusted = (e: IpcMainInvokeEvent) => !!e.senderFrame && e.senderFrame.parent === null && (e.senderFrame.origin === ORIGIN || e.senderFrame.url === OFFLINE_URL);
function handle(channel: string, fn: (...args: unknown[]) => unknown) {
  ipcMain.handle(`agent:${channel}`, (e, ...args) => {
    if (!trusted(e)) throw new Error("Not allowed");
    return fn(...args);
  });
}
const text = (v: unknown, max: number) => {
  if (typeof v !== "string" || !v || v.length > max) throw new Error("Invalid request");
  return v;
};

handle("pickFolder", async () => {
  const r = await dialog.showOpenDialog(win!, { title: "Pick a folder to sync with this project", properties: ["openDirectory", "createDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  picked.add(r.filePaths[0]);
  return r.filePaths[0];
});
handle("link", async (raw) => {
  const o = (raw ?? {}) as Record<string, unknown>;
  const info: LinkInfo = { workspaceId: text(o.workspaceId, 64), projectId: text(o.projectId, 64), projectName: text(o.projectName, 200), folder: text(o.folder, 4096) };
  // A page can only link a folder the owner just picked in the system dialog.
  if (!picked.has(info.folder)) return { error: "Pick the folder first" };
  try {
    return { status: await manager.link(info) };
  } catch (e) {
    return { error: (e as Error).message };
  }
});
handle("unlink", (id) => manager.unlink(text(id, 64)));
handle("linkOf", (id) => manager.linkOf(text(id, 64)));
handle("links", () => manager.links());
handle("openFolder", async (id) => {
  const l = manager.linkOf(text(id, 64));
  if (l) await shell.openPath(l.folder);
});
handle("confirmDeletes", (id) => manager.confirmDeletes(text(id, 64)));
handle("restoreDeleted", (id) => manager.restoreDeleted(text(id, 64)));
handle("retry", () => win?.loadURL(`${APP_URL}/app`));

// Every window: the site and Google sign-in stay inside, everything else opens in the normal browser.
app.on("web-contents-created", (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (sameSite(url)) return { action: "allow" };
    openOutside(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (e, url) => {
    if (sameSite(url) || signIn(url) || url === OFFLINE_URL) return;
    e.preventDefault();
    openOutside(url);
  });
});

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "Agent Company",
    backgroundColor: "#08110f",
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), additionalArguments: [`--agent-origin=${ORIGIN}`, `--agent-version=${app.getVersion()}`] },
  });
  win.once("ready-to-show", () => win?.show());
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
    // -3 is a navigation replaced by another one, not a failure.
    if (isMainFrame && code !== -3 && url !== OFFLINE_URL) void win?.loadFile(OFFLINE_PAGE);
  });
  win.on("focus", syncNow);
  win.on("closed", () => (win = null));
  void win.loadURL(`${APP_URL}/app`);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (!win) return createWindow();
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []), { role: "fileMenu" }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" }]),
    );
    await manager.load();
    createWindow();
    app.on("activate", () => {
      if (!win) createWindow();
    });
    syncNow();
    // Every 10 s while the window is in front, every minute behind; none while nobody's at the computer, so the database can sleep.
    // Folder changes are sent within seconds regardless (the manager watches the folders).
    setInterval(() => {
      if (powerMonitor.getSystemIdleTime() >= IDLE_SECONDS) return;
      if (Date.now() - lastRound >= (BrowserWindow.getFocusedWindow() ? 10_000 : 60_000)) syncNow();
    }, 1000);
  });
}
