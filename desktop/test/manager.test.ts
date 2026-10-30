import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { SyncManager } from "../src/sync/manager";
import type { Remote, RemoteFile, SyncStatus } from "../src/sync/types";

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "agent-mgr-"));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A project that answers slowly and remembers how many lists ran at once. */
class SlowRemote implements Remote {
  files = new Map<string, Buffer>();
  running = 0;
  maxRunning = 0;
  lists = 0;
  async list(): Promise<RemoteFile[]> {
    this.lists++;
    this.running++;
    this.maxRunning = Math.max(this.maxRunning, this.running);
    await wait(50);
    this.running--;
    return [];
  }
  async read(): Promise<Buffer> {
    return Buffer.alloc(0);
  }
  async save(p: string, data: Buffer) {
    this.files.set(p, data);
    return 1;
  }
  async remove() {}
}

async function setup(remote: Remote = new SlowRemote()) {
  const dir = await tmp();
  const file = path.join(dir, "sync.json");
  const statuses: [string, SyncStatus][] = [];
  const make = () =>
    new SyncManager({ file, baseUrl: "http://127.0.0.1:1", cookie: async () => "", trash: (abs) => fs.rm(abs), onStatus: (p, s) => statuses.push([p, s]), makeRemote: () => remote });
  const folder = async (name: string) => {
    const f = path.join(dir, name);
    await fs.mkdir(f, { recursive: true });
    return f;
  };
  return { make, folder, statuses, file };
}

test("links are saved and come back after a restart", async () => {
  const { make, folder } = await setup();
  const a = make();
  const f = await folder("site");
  const status = await a.link({ workspaceId: "w", projectId: "p1", projectName: "Bakery site", folder: f });
  expect(status.kind).toBe("synced");
  a.close();
  const b = make();
  await b.load();
  expect(b.links()).toEqual([{ workspaceId: "w", projectId: "p1", projectName: "Bakery site", folder: f }]);
  expect(b.linkOf("p1")?.folder).toBe(f);
  await b.unlink("p1");
  b.close();
  const c = make();
  await c.load();
  expect(c.links()).toEqual([]);
  c.close();
});

test("a folder and a project link only once, and folders can't nest", async () => {
  const { make, folder } = await setup();
  const m = make();
  const f = await folder("site");
  await m.link({ workspaceId: "w", projectId: "p1", projectName: "Bakery site", folder: f });
  await expect(m.link({ workspaceId: "w", projectId: "p2", projectName: "Other", folder: f })).rejects.toThrow("This folder is already synced with Bakery site");
  await expect(m.link({ workspaceId: "w", projectId: "p2", projectName: "Other", folder: await folder("site/inner") })).rejects.toThrow("This folder is inside a folder synced with Bakery site");
  await expect(m.link({ workspaceId: "w", projectId: "p2", projectName: "Other", folder: path.dirname(f) })).rejects.toThrow("This folder holds a folder synced with Bakery site");
  await expect(m.link({ workspaceId: "w", projectId: "p1", projectName: "Bakery site", folder: await folder("two") })).rejects.toThrow("This project is already synced with a folder");
  m.close();
});

test("rounds for one link never overlap, and a request during a round runs once after it", async () => {
  const remote = new SlowRemote();
  const { make, folder } = await setup(remote);
  const m = make();
  await m.link({ workspaceId: "w", projectId: "p1", projectName: "P", folder: await folder("site") });
  remote.lists = 0;
  await Promise.all([m.sync("p1"), m.sync("p1"), m.sync("p1"), m.sync("p1")]);
  expect(remote.maxRunning).toBe(1);
  expect(remote.lists).toBe(2);
  m.close();
});

test("a change in the folder is sent within a few seconds", async () => {
  const remote = new SlowRemote();
  const { make, folder, statuses } = await setup(remote);
  const m = make();
  const f = await folder("site");
  await m.link({ workspaceId: "w", projectId: "p1", projectName: "P", folder: f });
  await fs.writeFile(path.join(f, "hello.md"), "hi");
  for (let i = 0; i < 40 && !remote.files.has("hello.md"); i++) await wait(100);
  expect(remote.files.get("hello.md")?.toString()).toBe("hi");
  expect(statuses.some(([, s]) => s.kind === "syncing")).toBe(true);
  m.close();
});
