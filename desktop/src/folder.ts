import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// The server's exclusions (backend/src/files/rules.ts) plus build output and editor temp files.
export const SKIP_DIRS = [
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", ".next", ".nuxt", ".turbo", ".cache",
  "coverage", "__pycache__", ".venv", "venv", "target", ".gradle", ".idea",
];
const KEEP_FILES = [".env.example", ".env.sample"];
const SKIP_FILES = [
  /^\.env(\..+)?$/i,
  /\.(pem|key|p12|pfx|keystore)$/i,
  /^id_(rsa|ed25519)/i,
  /^(credentials\.json|\.npmrc|\.pypirc|\.netrc)$/i,
  /^\.DS_Store$/,
  /^Thumbs\.db$/i,
  /^~\$/,
  /\.swp$/,
  /^\.~lock\./,
];
const skipFile = (name: string) => !KEEP_FILES.includes(name.toLowerCase()) && SKIP_FILES.some((r) => r.test(name));
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const KEEP_VERSIONS = 20;
/** Like the server's project limit: a huge folder is listed up to here, not walked and hashed in full every time. */
const MAX_ENTRIES = 2000;

/** A file's revision as the server shows it: from its content, so it changes whenever the content does. */
export const rev = (hash: string) => parseInt(hash.slice(0, 12), 16) + 1;
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
// Version names sort by when they were kept, even when two land in the same millisecond.
let lastStamp = 0;
const stamp = () => (lastStamp = Math.max(Date.now(), lastStamp + 1));

export class FolderError extends Error {
  constructor(
    readonly code: "conflict" | "not_found" | "invalid" | "too_large",
    message: string,
  ) {
    super(message);
  }
}

/** Same rule as the server: text is UTF-8 with no zero bytes near the start. */
function isText(b: Buffer) {
  if (b.subarray(0, 8192).includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}

export type FolderEntry = { path: string; kind: "file" | "dir"; size: number; isText: boolean; hash: string | null; mtime: number };

/** A project's folder on this computer. Paths are relative with "/" on every system; nothing outside it, or behind a link, is reachable. */
export class Folder {
  private known = new Map<string, { mtimeMs: number; size: number; hash: string; isText: boolean }>();
  /** Changes run one at a time, so a check-then-write can't interleave with another (the team saving while the editor does). */
  private changes: Promise<unknown> = Promise.resolve();

  private oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.changes.then(fn, fn);
    this.changes = run.catch(() => {});
    return run;
  }

  constructor(
    readonly root: string,
    private versionsDir: string,
    private moveToTrash: (absPath: string) => Promise<void>,
  ) {}

  private async rootOk() {
    if (!(await fs.stat(this.root).catch(() => null))?.isDirectory()) throw new FolderError("not_found", `The folder ${this.root} isn't there anymore.`);
  }

  /** The absolute path for rel, after checking it stays inside the folder and passes through no link. */
  private async abs(rel: string) {
    const segs = rel.split("/");
    if (!rel || rel.includes("\\") || segs.some((s) => !s || s === "." || s === "..") || segs.slice(0, -1).some((s) => SKIP_DIRS.includes(s)) || SKIP_DIRS.includes(segs.at(-1)!) || skipFile(segs.at(-1)!)) {
      throw new FolderError("invalid", `${rel} isn't a path in this folder.`);
    }
    await this.rootOk();
    let p = this.root;
    for (const s of segs) {
      p = path.join(p, s);
      const st = await fs.lstat(p).catch(() => null);
      if (!st) break;
      if (st.isSymbolicLink()) throw new FolderError("invalid", `${rel} goes through a link, which the team doesn't follow.`);
    }
    return path.join(this.root, ...segs);
  }

  private async describe(abs: string) {
    const st = await fs.stat(abs);
    const k = this.known.get(abs);
    if (k && k.mtimeMs === st.mtimeMs && k.size === st.size) return k;
    if (st.size > MAX_FILE_BYTES) return { mtimeMs: st.mtimeMs, size: st.size, hash: null, isText: false };
    const data = await fs.readFile(abs);
    const d = { mtimeMs: st.mtimeMs, size: st.size, hash: sha(data), isText: isText(data) };
    this.known.set(abs, d);
    return d;
  }

  private listing: Promise<FolderEntry[]> | null = null;

  /** Callers asking at the same moment share one walk of the folder. */
  list(): Promise<FolderEntry[]> {
    return (this.listing ??= this.listNow().finally(() => (this.listing = null)));
  }

  private async listNow(): Promise<FolderEntry[]> {
    await this.rootOk();
    const out: FolderEntry[] = [];
    const walk = async (dir: string, rel: string) => {
      for (const d of await fs.readdir(dir, { withFileTypes: true })) {
        if (out.length >= MAX_ENTRIES) return;
        const p = rel ? `${rel}/${d.name}` : d.name;
        const abs = path.join(dir, d.name);
        if (d.isDirectory()) {
          if (SKIP_DIRS.includes(d.name)) continue;
          out.push({ path: p, kind: "dir", size: 0, isText: false, hash: null, mtime: 0 });
          await walk(abs, p);
        } else if (d.isFile() && !skipFile(d.name)) {
          const f = await this.describe(abs).catch(() => null);
          if (f) out.push({ path: p, kind: "file", size: f.size, isText: f.isText, hash: f.hash, mtime: f.mtimeMs });
        }
      }
    };
    await walk(this.root, "");
    return out;
  }

  async read(rel: string) {
    const abs = await this.abs(rel);
    const st = await fs.stat(abs).catch(() => null);
    if (!st?.isFile()) throw new FolderError("not_found", `There is no file at ${rel}.`);
    if (st.size > MAX_FILE_BYTES) throw new FolderError("too_large", `${rel} is over 10 MB.`);
    return fs.readFile(abs);
  }

  /** base 0 creates a new file; otherwise the file must still be the version the caller read (its rev). */
  write(rel: string, data: Buffer, base: number) {
    return this.oneAtATime(() => this.writeNow(rel, data, base));
  }

  private async writeNow(rel: string, data: Buffer, base: number) {
    const abs = await this.abs(rel);
    if (data.length > MAX_FILE_BYTES) throw new FolderError("too_large", "Files can be up to 10 MB.");
    const st = await fs.stat(abs).catch(() => null);
    if (st?.isDirectory()) throw new FolderError("conflict", `${rel} is a folder.`);
    if (base === 0 && st) throw new FolderError("conflict", "A file with this name already exists.");
    if (base !== 0) {
      const current = st ? await this.describe(abs) : null;
      if (!current?.hash || rev(current.hash) !== base) throw new FolderError("conflict", "This file changed since you opened it. Reload to see the latest version.");
      await this.keep(rel, abs);
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, data);
    this.known.delete(abs);
    return sha(data);
  }

  remove(rel: string) {
    return this.oneAtATime(async () => {
      const abs = await this.abs(rel);
      if (!(await fs.lstat(abs).catch(() => null))) throw new FolderError("not_found", `There is nothing at ${rel}.`);
      await this.moveToTrash(abs);
    });
  }

  async mkdir(rel: string) {
    await fs.mkdir(await this.abs(rel), { recursive: true });
  }

  move(from: string, to: string) {
    return this.oneAtATime(async () => {
      const src = await this.abs(from);
      const dest = await this.abs(to);
      if (!(await fs.lstat(src).catch(() => null))) throw new FolderError("not_found", `There is nothing at ${from}.`);
      if (await fs.lstat(dest).catch(() => null)) throw new FolderError("conflict", "Something with that name already exists there.");
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.rename(src, dest);
    });
  }

  /** Named by a hash of the path: any file name fits the disk's limit on folder names. */
  private dirOf(rel: string) {
    return path.join(this.versionsDir, createHash("sha256").update(rel).digest("hex"));
  }

  /** Keeps the file's current content before it's replaced; the newest 20 stay. */
  private async keep(rel: string, abs: string) {
    const dir = this.dirOf(rel);
    await fs.mkdir(dir, { recursive: true });
    await fs.copyFile(abs, path.join(dir, `${stamp()}-${randomBytes(3).toString("hex")}`));
    const old = (await fs.readdir(dir)).sort().reverse().slice(KEEP_VERSIONS);
    await Promise.all(old.map((n) => fs.rm(path.join(dir, n))));
  }

  /** Newest first. */
  async versions(rel: string) {
    await this.abs(rel);
    const dir = this.dirOf(rel);
    const names = (await fs.readdir(dir).catch(() => [] as string[])).sort().reverse();
    return Promise.all(names.map(async (id) => ({ id, at: Number(id.split("-")[0]), size: (await fs.stat(path.join(dir, id))).size })));
  }

  async version(rel: string, id: string) {
    await this.abs(rel);
    if (!/^\d+-[0-9a-f]{6}$/.test(id)) throw new FolderError("not_found", "Version not found.");
    return fs.readFile(path.join(this.dirOf(rel), id)).catch(() => {
      throw new FolderError("not_found", "Version not found.");
    });
  }

  restore(rel: string, id: string) {
    return this.oneAtATime(() => this.restoreNow(rel, id));
  }

  private async restoreNow(rel: string, id: string) {
    const data = await this.version(rel, id);
    const abs = await this.abs(rel);
    if (await fs.stat(abs).catch(() => null)) await this.keep(rel, abs);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, data);
    this.known.delete(abs);
    return sha(data);
  }
}
