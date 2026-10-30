import { contextBridge, ipcRenderer } from "electron";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";
// window.origin, not location.origin: a page sandboxed by its CSP (the site's previews) has the site's address but no origin.
const allowed = window.origin === arg("agent-origin") || (location.protocol === "file:" && location.pathname.endsWith("/static/offline.html"));

if (allowed) {
  const call = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(`agent:${channel}`, ...args);
  contextBridge.exposeInMainWorld("agentDesktop", {
    version: arg("agent-version"),
    deviceId: arg("agent-device"),
    pickFolder: () => call("pickFolder"),
    attach: (projectId: string, folder: string) => call("attach", projectId, folder),
    folderOf: (projectId: string) => call("folderOf", projectId),
    projectOf: (folder: string) => call("projectOf", folder),
    folders: () => call("folders"),
    showFolder: (projectId: string) => call("showFolder", projectId),
    forget: (projectId: string) => call("forget", projectId),
    retry: () => call("retry"),
  });
}
