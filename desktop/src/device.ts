import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Folder, FolderError } from "./folder";

export type Call = { id: string; projectId: string; op: string; args: Record<string, unknown> };
export type Reply = { id: string; ok: boolean; result?: unknown; error?: { code?: string; message: string } };

async function saveJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value));
  await fs.rename(tmp, file);
}

/** This app install's id, made once: the server sends a project's file requests to the install that has its folder. */
export async function deviceId(dataDir: string): Promise<string> {
  const file = path.join(dataDir, "device.json");
  const saved = JSON.parse(await fs.readFile(file, "utf8").catch(() => "{}")) as { id?: string };
  if (saved.id) return saved.id;
  const id = randomUUID();
  await saveJson(file, { id });
  return id;
}

/** Which folder holds each project opened on this computer, kept in the app's data folder. */
export class Folders {
  private map: Record<string, string> = {};
  private open = new Map<string, Folder>();

  constructor(
    private dataDir: string,
    private trash: (absPath: string) => Promise<void>,
  ) {}

  private get file() {
    return path.join(this.dataDir, "folders.json");
  }

  async load() {
    this.map = JSON.parse(await fs.readFile(this.file, "utf8").catch(() => "{}"));
  }

  list() {
    return Object.entries(this.map).map(([projectId, folder]) => ({ projectId, folder }));
  }

  folderOf(projectId: string): string | null {
    return this.map[projectId] ?? null;
  }

  projectOf(folder: string): string | null {
    const f = path.resolve(folder);
    return Object.keys(this.map).find((k) => this.map[k] === f) ?? null;
  }

  async attach(projectId: string, folder: string) {
    this.map[projectId] = path.resolve(folder);
    this.open.delete(projectId);
    await saveJson(this.file, this.map);
  }

  async forget(projectId: string) {
    delete this.map[projectId];
    this.open.delete(projectId);
    await saveJson(this.file, this.map);
  }

  get(projectId: string): Folder | null {
    const root = this.map[projectId];
    if (!root) return null;
    let f = this.open.get(projectId);
    if (!f) this.open.set(projectId, (f = new Folder(root, path.join(this.dataDir, "versions", projectId), this.trash)));
    return f;
  }
}

const text = (v: unknown) => (typeof v === "string" ? v : "");
const b64 = (b: Buffer) => b.toString("base64");

async function handle(call: Call, folders: Folders): Promise<unknown> {
  const f = folders.get(call.projectId);
  if (!f) throw new FolderError("not_found", "This project's folder isn't open in the app on this computer. Open the folder again.");
  const a = call.args ?? {};
  switch (call.op) {
    case "list":
      return { entries: await f.list() };
    case "read":
      return { base64: b64(await f.read(text(a.path))) };
    case "write":
      return { hash: await f.write(text(a.path), a.base64 !== undefined ? Buffer.from(text(a.base64), "base64") : Buffer.from(text(a.content), "utf8"), Number(a.base) || 0) };
    case "remove":
      await f.remove(text(a.path));
      return {};
    case "mkdir":
      await f.mkdir(text(a.path));
      return {};
    case "move":
      await f.move(text(a.from), text(a.to));
      return {};
    case "versions":
      return { versions: await f.versions(text(a.path)) };
    case "version":
      return { base64: b64(await f.version(text(a.path), text(a.id))) };
    case "restore":
      return { hash: await f.restore(text(a.path), text(a.id)) };
  }
  throw new FolderError("invalid", `The app doesn't know how to ${call.op}.`);
}

/** The answer to one request from the server, never a thrown error. */
export async function reply(call: Call, folders: Folders): Promise<Reply> {
  try {
    return { id: call.id, ok: true, result: await handle(call, folders) };
  } catch (e) {
    return { id: call.id, ok: false, error: { code: e instanceof FolderError ? e.code : undefined, message: (e instanceof Error ? e.message : String(e)).slice(0, 500) } };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Asks the server for file requests (a long poll) and answers each from the folders, for as long as it runs. */
export class Device {
  private stopped = false;

  constructor(
    private o: { baseUrl: string; id: string; cookie: () => Promise<string>; folders: Folders; active: () => boolean; onRequest?: () => void; wait?: number },
  ) {}

  private async headers() {
    return { cookie: await this.o.cookie(), origin: this.o.baseUrl };
  }

  async run() {
    const wait = this.o.wait ?? 20;
    while (!this.stopped) {
      if (!this.o.active()) {
        await sleep(5000);
        continue;
      }
      try {
        const res = await fetch(`${this.o.baseUrl}/api/desktop/poll?device=${this.o.id}&wait=${wait}`, { headers: await this.headers(), signal: AbortSignal.timeout((wait + 15) * 1000) });
        if (!res.ok) {
          await sleep(res.status === 401 ? 10_000 : 5_000);
          continue;
        }
        const { calls } = (await res.json()) as { calls: Call[] };
        if (calls.length) this.o.onRequest?.();
        for (const c of calls) void this.answer(c);
      } catch {
        if (!this.stopped) await sleep(5000);
      }
    }
  }

  private async answer(call: Call) {
    const body = await reply(call, this.o.folders);
    await fetch(`${this.o.baseUrl}/api/desktop/reply`, {
      method: "POST",
      headers: { ...(await this.headers()), "content-type": "application/json" },
      body: JSON.stringify({ device: this.o.id, ...body }),
      signal: AbortSignal.timeout(120_000),
    }).catch(() => {});
  }

  stop() {
    this.stopped = true;
  }
}
