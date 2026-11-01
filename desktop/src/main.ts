import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, Menu, powerMonitor, session, shell } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { APP_URL } from "./config";
import { Device, deviceId, Folders } from "./device";

const ORIGIN = new URL(APP_URL).origin;
const OFFLINE_PAGE = path.join(__dirname, "..", "static", "offline.html");
const OFFLINE_URL = pathToFileURL(OFFLINE_PAGE).href;
/** The app keeps answering the team while someone used the computer, or the team asked for files, in the last half hour. */
const AWAKE_MS = 30 * 60_000;

if (process.env.AGENT_COMPANY_DATA) app.setPath("userData", process.env.AGENT_COMPANY_DATA);
// The user agent Chrome itself sends: Google refuses sign-in from browsers that name themselves embedded.
app.userAgentFallback = `Mozilla/5.0 (${process.platform === "darwin" ? "Macintosh; Intel Mac OS X 10_15_7" : "Windows NT 10.0; Win64; x64"}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome.split(".")[0]}.0.0.0 Safari/537.36`;

const sameSite = (url: string) => URL.canParse(url) && new URL(url).origin === ORIGIN;
const signIn = (url: string) => URL.canParse(url) && new URL(url).origin === "https://accounts.google.com";
const staysInside = (url: string) => sameSite(url) || signIn(url) || url === OFFLINE_URL;
const openOutside = (url: string) => {
  if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
};

let win: BrowserWindow | null = null;
let device = "";
let lastRequest = 0;
const picked = new Set<string>();
const folders = new Folders(app.getPath("userData"), (abs) => shell.trashItem(abs));

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

async function pickFolder() {
  const r = await dialog.showOpenDialog(win!, { title: "Open a folder as a project", buttonLabel: "Open", properties: ["openDirectory", "createDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  picked.add(r.filePaths[0]);
  return r.filePaths[0];
}
handle("pickFolder", pickFolder);

/** File → Open Folder… (⌘O), like an editor: the page opens the folder as a project. */
async function openFolderFromMenu() {
  if (!win) createWindow();
  const folder = await pickFolder();
  if (folder && win && sameSite(win.webContents.getURL())) win.webContents.send("agent:open-folder", folder);
}
handle("attach", async (projectId, folder) => {
  // A page can only attach a folder the owner just picked in the system dialog.
  if (!picked.has(text(folder, 4096))) throw new Error("Pick the folder first");
  await folders.attach(text(projectId, 64), folder as string);
});
handle("folderOf", (projectId) => folders.folderOf(text(projectId, 64)));
handle("projectOf", (folder) => folders.projectOf(text(folder, 4096)));
handle("folders", () => folders.list());
handle("showFolder", async (projectId) => {
  const f = folders.folderOf(text(projectId, 64));
  if (f) await shell.openPath(f);
});
handle("forget", (projectId) => folders.forget(text(projectId, 64)));
handle("retry", () => win?.loadURL(`${APP_URL}/app`));

// Every window: the site and Google sign-in stay inside, everything else opens in the normal browser.
app.on("web-contents-created", (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (sameSite(url)) return { action: "allow" };
    openOutside(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (e, url) => {
    if (staysInside(url)) return;
    e.preventDefault();
    openOutside(url);
  });
  contents.on("will-redirect", (e, url, _inPlace, isMainFrame) => {
    if (!isMainFrame || staysInside(url)) return;
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
    webPreferences: { preload: path.join(__dirname, "preload.js"), additionalArguments: [`--agent-origin=${ORIGIN}`, `--agent-version=${app.getVersion()}`, `--agent-device=${device}`] },
  });
  win.once("ready-to-show", () => win?.show());
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
    // -3 is a navigation replaced by another one, not a failure.
    if (isMainFrame && code !== -3 && url !== OFFLINE_URL) void win?.loadFile(OFFLINE_PAGE);
  });
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
      Menu.buildFromTemplate([
        ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
        { label: "File", submenu: [{ id: "open-folder", label: "Open Folder…", accelerator: "CmdOrCtrl+O", click: () => void openFolderFromMenu() }, { type: "separator" }, { role: process.platform === "darwin" ? "close" : "quit" }] },
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
      ]),
    );
    // No camera, microphone, location or the like for any page; copying to the clipboard and full screen for the site only.
    const allowed = (permission: string, url: string) => sameSite(url) && (permission === "clipboard-sanitized-write" || permission === "fullscreen");
    session.defaultSession.setPermissionRequestHandler((_wc, permission, done, details) => done(allowed(permission, details.requestingUrl)));
    session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => allowed(permission, origin));

    device = await deviceId(app.getPath("userData"));
    await folders.load();
    createWindow();
    app.on("activate", () => {
      if (!win) createWindow();
    });
    // Answers the team's file requests for the folders opened here, for as long as the app runs.
    void new Device({
      baseUrl: APP_URL,
      id: device,
      cookie: async () => (await session.defaultSession.cookies.get({ url: APP_URL })).map((c) => `${c.name}=${c.value}`).join("; "),
      folders,
      active: () => powerMonitor.getSystemIdleTime() * 1000 < AWAKE_MS || Date.now() - lastRequest < AWAKE_MS,
      onRequest: () => (lastRequest = Date.now()),
    }).run();
  });
}
