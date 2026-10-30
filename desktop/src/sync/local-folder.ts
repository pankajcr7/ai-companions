import { createHash } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { MAX_FILE_BYTES } from "./engine";
import type { Local, LocalFile } from "./types";

// The server's exclusions (backend/src/files/rules.ts, parity tested there) plus build output and editor temp files.
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

/** A linked folder on this computer. Paths are relative with "/" on every system. */
export class LocalFolder implements Local {
  private hashes = new Map<string, { mtimeMs: number; size: number; hash: string }>();

  constructor(
    readonly root: string,
    private moveToTrash: (absPath: string) => Promise<void>,
  ) {}

  private abs(rel: string) {
    const p = path.resolve(this.root, ...rel.split("/"));
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error(`${rel} is outside the folder`);
    return p;
  }

  private async hashOf(abs: string, st: { mtimeMs: number; size: number }) {
    const known = this.hashes.get(abs);
    if (known && known.mtimeMs === st.mtimeMs && known.size === st.size) return known.hash;
    const hash = createHash("sha256").update(await fs.readFile(abs)).digest("hex");
    this.hashes.set(abs, { mtimeMs: st.mtimeMs, size: st.size, hash });
    return hash;
  }

  async list(): Promise<LocalFile[] | "missing"> {
    try {
      if (!(await fs.stat(this.root)).isDirectory()) return "missing";
    } catch {
      return "missing";
    }
    const out: LocalFile[] = [];
    const walk = async (dir: string, rel: string) => {
      for (const d of await fs.readdir(dir, { withFileTypes: true })) {
        const p = rel ? `${rel}/${d.name}` : d.name;
        const abs = path.join(dir, d.name);
        if (d.isDirectory()) {
          if (!SKIP_DIRS.includes(d.name)) await walk(abs, p);
        } else if (d.isFile() && !skipFile(d.name)) {
          // Symbolic links are neither: nothing outside the folder is followed.
          const st = await fs.stat(abs).catch(() => null);
          if (st) out.push({ path: p, size: st.size, hash: st.size > MAX_FILE_BYTES ? "" : await this.hashOf(abs, st) });
        }
      }
    };
    await walk(this.root, "");
    return out;
  }

  async read(rel: string) {
    return fs.readFile(this.abs(rel));
  }

  async write(rel: string, data: Buffer) {
    const abs = this.abs(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, data);
    const hash = createHash("sha256").update(data).digest("hex");
    const st = await fs.stat(abs);
    this.hashes.set(abs, { mtimeMs: st.mtimeMs, size: st.size, hash });
    return hash;
  }

  async trash(rel: string) {
    return this.moveToTrash(this.abs(rel));
  }

  async copy(from: string, to: string) {
    return fs.copyFile(this.abs(from), this.abs(to), constants.COPYFILE_EXCL);
  }
}
