import { type FSWatcher, watch } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { confirmDeletes, restoreDeleted, syncOnce } from "./engine";
import { LocalFolder, SKIP_DIRS } from "./local-folder";
import { ProjectApi } from "./project-api";
import type { LinkState, Remote, SyncStatus } from "./types";

export type LinkInfo = { workspaceId: string; projectId: string; projectName: string; folder: string };
type Link = LinkInfo & { state: LinkState; pending?: "confirm" | "restore" };

const inside = (parent: string, child: string) => {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** Keeps every linked folder in step with its project: one round at a time per link, state saved after each. */
export class SyncManager {
  private byId = new Map<string, Link>();
  private status = new Map<string, SyncStatus>();
  private locals = new Map<string, LocalFolder>();
  private watchers = new Map<string, FSWatcher>();
  private timers = new Map<string, NodeJS.Timeout>();
  private running = new Map<string, Promise<void>>();
  private queued = new Map<string, Promise<void>>();
  private saves = 0;

  constructor(
    private o: {
      file: string;
      baseUrl: string;
      cookie: () => Promise<string>;
      trash: (absPath: string) => Promise<void>;
      onStatus: (projectId: string, status: SyncStatus) => void;
      makeRemote?: (link: LinkInfo) => Remote;
    },
  ) {}

  async load() {
    const saved = JSON.parse(await fs.readFile(this.o.file, "utf8").catch(() => '{"links":[]}')) as { links: Link[] };
    for (const l of saved.links) {
      this.byId.set(l.projectId, l);
      this.watch(l);
    }
  }

  links(): LinkInfo[] {
    return [...this.byId.values()].map(({ workspaceId, projectId, projectName, folder }) => ({ workspaceId, projectId, projectName, folder }));
  }

  linkOf(projectId: string) {
    const l = this.byId.get(projectId);
    return l ? { folder: l.folder, status: this.status.get(projectId) ?? null } : null;
  }

  async link(info: LinkInfo): Promise<SyncStatus> {
    const folder = path.resolve(info.folder);
    for (const l of this.byId.values()) {
      if (l.projectId === info.projectId) throw new Error("This project is already synced with a folder");
      if (path.relative(l.folder, folder) === "") throw new Error(`This folder is already synced with ${l.projectName}`);
      if (inside(l.folder, folder)) throw new Error(`This folder is inside a folder synced with ${l.projectName}`);
      if (inside(folder, l.folder)) throw new Error(`This folder holds a folder synced with ${l.projectName}`);
    }
    if (!(await fs.stat(folder).catch(() => null))?.isDirectory()) throw new Error("Folder not found");
    const l: Link = { ...info, folder, state: { synced: {}, deletedHere: [] } };
    this.byId.set(l.projectId, l);
    await this.save();
    this.watch(l);
    await this.sync(l.projectId);
    return this.status.get(l.projectId)!;
  }

  async unlink(projectId: string) {
    this.byId.delete(projectId);
    this.status.delete(projectId);
    this.locals.delete(projectId);
    this.watchers.get(projectId)?.close();
    this.watchers.delete(projectId);
    clearTimeout(this.timers.get(projectId));
    await this.save();
  }

  /** "Delete them in the project too" and "Bring them back" run inside the next round, never beside one. */
  confirmDeletes(projectId: string) {
    return this.request(projectId, "confirm");
  }

  restoreDeleted(projectId: string) {
    return this.request(projectId, "restore");
  }

  private request(projectId: string, what: "confirm" | "restore") {
    const l = this.byId.get(projectId);
    if (l) l.pending = what;
    return this.sync(projectId);
  }

  syncAll() {
    return Promise.all([...this.byId.keys()].map((id) => this.sync(id)));
  }

  /** Runs a round now, or once more after the current one when one is running. */
  sync(projectId: string): Promise<void> {
    const current = this.running.get(projectId);
    if (!current) return this.start(projectId);
    let next = this.queued.get(projectId);
    if (!next) {
      next = current.then(() => {
        this.queued.delete(projectId);
        return this.start(projectId);
      });
      this.queued.set(projectId, next);
    }
    return next;
  }

  close() {
    for (const w of this.watchers.values()) w.close();
    for (const t of this.timers.values()) clearTimeout(t);
    this.watchers.clear();
  }

  private start(projectId: string) {
    const p = this.round(projectId).finally(() => this.running.delete(projectId));
    this.running.set(projectId, p);
    return p;
  }

  private async round(projectId: string) {
    const l = this.byId.get(projectId);
    if (!l) return;
    const remote = this.o.makeRemote?.(l) ?? new ProjectApi({ baseUrl: this.o.baseUrl, workspaceId: l.workspaceId, projectId: l.projectId, cookie: this.o.cookie });
    let local = this.locals.get(projectId);
    if (!local) this.locals.set(projectId, (local = new LocalFolder(l.folder, this.o.trash)));
    let status: SyncStatus;
    try {
      if (l.pending === "restore") l.state = restoreDeleted(l.state);
      if (l.pending === "confirm") l.state = await confirmDeletes(remote, l.state);
      l.pending = undefined;
      const before = this.status.get(projectId);
      const r = await syncOnce(remote, local, l.state, Date.now(), (n) =>
        this.emit(projectId, { kind: "syncing", at: Date.now(), waiting: n, conflicts: before?.conflicts ?? [], deletedHere: [], skipped: [], readOnly: before?.readOnly ?? false }),
      );
      l.state = r.state;
      status = r.status;
    } catch (e) {
      status = { kind: "error", at: Date.now(), waiting: 0, conflicts: [], deletedHere: l.state.deletedHere, skipped: [], readOnly: false, message: e instanceof Error ? e.message : String(e) };
    }
    if (!this.byId.has(projectId)) return;
    await this.save();
    this.emit(projectId, status);
    if (!this.watchers.has(projectId) && status.message !== "Folder not found") this.watch(l);
  }

  private emit(projectId: string, status: SyncStatus) {
    this.status.set(projectId, status);
    this.o.onStatus(projectId, status);
  }

  private watch(l: Link) {
    try {
      const w = watch(l.folder, { recursive: true }, (_event, name) => {
        if (name && String(name).split(/[\\/]/).some((s) => SKIP_DIRS.includes(s))) return;
        clearTimeout(this.timers.get(l.projectId));
        this.timers.set(l.projectId, setTimeout(() => void this.sync(l.projectId), 1500));
      });
      w.on("error", () => {
        w.close();
        this.watchers.delete(l.projectId);
      });
      this.watchers.set(l.projectId, w);
    } catch {
      // The folder is missing; rounds say so, and watching starts again once it's back.
    }
  }

  private async save() {
    const tmp = `${this.o.file}.${++this.saves}.tmp`;
    await fs.mkdir(path.dirname(this.o.file), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify({ links: [...this.byId.values()] }));
    await fs.rename(tmp, this.o.file);
  }
}
