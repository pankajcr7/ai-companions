import { contextBridge, ipcRenderer } from "electron";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";
// window.origin, not location.origin: a page sandboxed by its CSP (the site's previews) has the site's address but no origin.
const allowed = window.origin === arg("agent-origin") || (location.protocol === "file:" && location.pathname.endsWith("/static/offline.html"));

if (allowed) {
  const call = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(`agent:${channel}`, ...args);
  contextBridge.exposeInMainWorld("agentDesktop", {
    version: arg("agent-version"),
    pickFolder: () => call("pickFolder"),
    link: async (o: unknown) => {
      const r = (await call("link", o)) as { status?: unknown; error?: string };
      if (r.error) throw new Error(r.error);
      return r.status;
    },
    unlink: (projectId: string) => call("unlink", projectId),
    linkOf: (projectId: string) => call("linkOf", projectId),
    links: () => call("links"),
    openFolder: (projectId: string) => call("openFolder", projectId),
    confirmDeletes: (projectId: string) => call("confirmDeletes", projectId),
    restoreDeleted: (projectId: string) => call("restoreDeleted", projectId),
    retry: () => call("retry"),
    onStatus: (cb: (projectId: string, status: unknown) => void) => {
      const listener = (_e: unknown, projectId: string, status: unknown) => cb(projectId, status);
      ipcRenderer.on("agent:status", listener);
      return () => void ipcRenderer.removeListener("agent:status", listener);
    },
  });
}
