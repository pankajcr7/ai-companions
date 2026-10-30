import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { confirmDeletes, copyName, restoreDeleted, syncOnce } from "../src/sync/engine";
import { type LinkState, type Local, type LocalFile, type Remote, RemoteError, type RemoteErrorKind, type RemoteFile } from "../src/sync/types";

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const NOW = 1_000_000;

class FakeRemote implements Remote {
  files = new Map<string, { path: string; rev: number; data: string }>();
  failList?: RemoteErrorKind;
  failSaveAfter?: { n: number; kind: RemoteErrorKind };
  readOnly = false;
  saves: string[] = [];
  removed: string[] = [];
  constructor(init: Record<string, string> = {}) {
    for (const [p, d] of Object.entries(init)) this.put(p, d);
  }
  put(path: string, data: string) {
    const old = this.files.get(path.toLowerCase());
    this.files.set(path.toLowerCase(), { path: old?.path ?? path, rev: (old?.rev ?? 0) + 1, data });
  }
  get(path: string) {
    return this.files.get(path.toLowerCase())?.data;
  }
  async list(): Promise<RemoteFile[]> {
    if (this.failList) throw new RemoteError(this.failList, this.failList);
    return [...this.files.values()].map((f) => ({ path: f.path, rev: f.rev, hash: sha(f.data), size: f.data.length }));
  }
  async read(path: string) {
    return Buffer.from(this.files.get(path.toLowerCase())!.data);
  }
  async save(path: string, data: Buffer, baseRev: number) {
    if (this.readOnly) throw new RemoteError("read-only", "read-only");
    if (this.failSaveAfter && this.saves.length >= this.failSaveAfter.n) throw new RemoteError(this.failSaveAfter.kind, "nope");
    const cur = this.files.get(path.toLowerCase());
    if ((cur?.rev ?? 0) !== baseRev) throw new RemoteError("conflict", "changed");
    this.saves.push(path);
    this.put(path, data.toString());
    return this.files.get(path.toLowerCase())!.rev;
  }
  async remove(path: string) {
    this.removed.push(path);
    this.files.delete(path.toLowerCase());
  }
}

class FakeLocal implements Local {
  files = new Map<string, { path: string; data: string }>();
  trashed: string[] = [];
  writes: string[] = [];
  missing = false;
  /** Simulates an edit landing right after the engine reads a file. */
  afterRead?: (path: string) => void;
  constructor(init: Record<string, string> = {}) {
    for (const [p, d] of Object.entries(init)) this.put(p, d);
  }
  put(path: string, data: string) {
    this.files.set(path.toLowerCase(), { path, data });
  }
  get(path: string) {
    return this.files.get(path.toLowerCase())?.data;
  }
  async list(): Promise<LocalFile[] | "missing"> {
    if (this.missing) return "missing";
    return [...this.files.values()].map((f) => ({ path: f.path, hash: sha(f.data), size: f.data.length }));
  }
  async read(path: string) {
    const data = Buffer.from(this.files.get(path.toLowerCase())!.data);
    this.afterRead?.(path);
    return data;
  }
  async write(path: string, data: Buffer) {
    this.writes.push(path);
    const old = this.files.get(path.toLowerCase());
    this.put(old?.path ?? path, data.toString());
    return sha(data);
  }
  async trash(path: string) {
    this.trashed.push(path);
    this.files.delete(path.toLowerCase());
  }
  async copy(from: string, to: string) {
    this.put(to, this.files.get(from.toLowerCase())!.data);
  }
}

const fresh = (): LinkState => ({ synced: {}, deletedHere: [] });

/** Links, then syncs once more so both sides start in step. */
async function linked(remote: FakeRemote, local: FakeLocal) {
  const { state } = await syncOnce(remote, local, fresh(), NOW);
  return (await syncOnce(remote, local, state, NOW)).state;
}

test("copyName", () => {
  expect(copyName("notes.md")).toBe("notes (my copy).md");
  expect(copyName("a/b.tar.gz")).toBe("a/b.tar (my copy).gz");
  expect(copyName("LICENSE")).toBe("LICENSE (my copy)");
  expect(copyName("src/.gitignore")).toBe("src/.gitignore (my copy)");
  expect(copyName("notes.md", 2)).toBe("notes (my copy 2).md");
});

test("first link: four cases", async () => {
  const remote = new FakeRemote({ "only-project.md": "p", "same.md": "s", "differs.md": "project" });
  const local = new FakeLocal({ "only-here.md": "h", "same.md": "s", "differs.md": "mine" });
  const { status } = await syncOnce(remote, local, fresh(), NOW);
  expect(local.get("only-project.md")).toBe("p");
  expect(remote.get("only-here.md")).toBe("h");
  expect(remote.get("same.md")).toBe("s");
  expect(local.get("differs.md")).toBe("project");
  expect(local.get("differs (my copy).md")).toBe("mine");
  expect(remote.get("differs.md")).toBe("project");
  expect(remote.get("differs (my copy).md")).toBeUndefined();
  expect(remote.saves).toEqual(["only-here.md"]);
  expect(status).toMatchObject({ kind: "synced", at: NOW, conflicts: ["differs (my copy).md"] });
});

test("no sync loop: a second round after any round does nothing", async () => {
  const remote = new FakeRemote({ "a.md": "a", "b/c.txt": "c", "x.md": "project" });
  const local = new FakeLocal({ "d.md": "d", "x.md": "mine" });
  const { state } = await syncOnce(remote, local, fresh(), NOW);
  remote.saves = [];
  local.writes = [];
  let syncing = 0;
  const again = await syncOnce(remote, local, state, NOW, () => syncing++);
  expect(remote.saves).toEqual([]);
  expect(local.writes).toEqual([]);
  expect(local.trashed).toEqual([]);
  expect(syncing).toBe(0);
  expect(again.status.conflicts).toEqual(["x (my copy).md"]);
});

test("only the project changed: download", async () => {
  const remote = new FakeRemote({ "a.md": "1" });
  const local = new FakeLocal();
  const state = await linked(remote, local);
  remote.put("a.md", "2");
  await syncOnce(remote, local, state, NOW);
  expect(local.get("a.md")).toBe("2");
});

test("only the local file changed: upload on the synced revision", async () => {
  const remote = new FakeRemote({ "a.md": "1" });
  const local = new FakeLocal();
  const state = await linked(remote, local);
  local.put("a.md", "2");
  const { state: after } = await syncOnce(remote, local, state, NOW);
  expect(remote.get("a.md")).toBe("2");
  expect(after.synced["a.md"]).toEqual({ path: "a.md", rev: 2, hash: sha("2") });
});

test("both changed: the project version is written and mine is kept as a copy", async () => {
  const remote = new FakeRemote({ "a.md": "1" });
  const local = new FakeLocal();
  const state = await linked(remote, local);
  remote.put("a.md", "theirs");
  local.put("a.md", "mine");
  const { status } = await syncOnce(remote, local, state, NOW);
  expect(local.get("a.md")).toBe("theirs");
  expect(local.get("a (my copy).md")).toBe("mine");
  expect(remote.get("a.md")).toBe("theirs");
  expect(status.conflicts).toEqual(["a (my copy).md"]);
});

test("a second conflict on the same file doesn't overwrite the first copy", async () => {
  const remote = new FakeRemote({ "a.md": "1" });
  const local = new FakeLocal({ "a (my copy).md": "older copy" });
  const state = await linked(remote, local);
  remote.put("a.md", "theirs");
  local.put("a.md", "mine");
  await syncOnce(remote, local, state, NOW);
  expect(local.get("a (my copy).md")).toBe("older copy");
  expect(local.get("a (my copy 2).md")).toBe("mine");
});

test("deleted here, project unchanged: listed, nothing deleted in the project", async () => {
  const remote = new FakeRemote({ "a.md": "1", "b.md": "2" });
  const local = new FakeLocal();
  const state = await linked(remote, local);
  local.files.delete("a.md");
  const { state: after, status } = await syncOnce(remote, local, state, NOW);
  expect(remote.get("a.md")).toBe("1");
  expect(remote.removed).toEqual([]);
  expect(local.get("a.md")).toBeUndefined();
  expect(status.deletedHere).toEqual(["a.md"]);
  // It stays listed on later rounds, and is not downloaded again.
  expect((await syncOnce(remote, local, after, NOW)).status.deletedHere).toEqual(["a.md"]);
  expect(local.get("a.md")).toBeUndefined();
});

test("deleted here, then changed in the project: the newer version comes back", async () => {
  const remote = new FakeRemote({ "a.md": "1" });
  const local = new FakeLocal();
  const state = await linked(remote, local);
  local.files.delete("a.md");
  remote.put("a.md", "newer");
  const { status } = await syncOnce(remote, local, state, NOW);
  expect(local.get("a.md")).toBe("newer");
  expect(status.deletedHere).toEqual([]);
});

test("deleted in the project, local unchanged: the local file goes to the Trash", async () => {
  const remote = new FakeRemote({ "a.md": "1" });
  const local = new FakeLocal();
  const state = await linked(remote, local);
  remote.files.delete("a.md");
  const { state: after } = await syncOnce(remote, local, state, NOW);
  expect(local.trashed).toEqual(["a.md"]);
  expect(after.synced["a.md"]).toBeUndefined();
});

test("deleted in the project, local changed: nothing is lost, it goes back up", async () => {
  const remote = new FakeRemote({ "a.md": "1" });
  const local = new FakeLocal();
  const state = await linked(remote, local);
  remote.files.delete("a.md");
  local.put("a.md", "my edit");
  await syncOnce(remote, local, state, NOW);
  expect(local.trashed).toEqual([]);
  expect(remote.get("a.md")).toBe("my edit");
});

test("gone on both sides: forgotten", async () => {
  const remote = new FakeRemote({ "a.md": "1" });
  const local = new FakeLocal();
  const state = await linked(remote, local);
  remote.files.delete("a.md");
  local.files.delete("a.md");
  const { state: after } = await syncOnce(remote, local, state, NOW);
  expect(after.synced).toEqual({});
});

test("offline counts waiting changes and changes nothing", async () => {
  const remote = new FakeRemote({ "a.md": "1" });
  const local = new FakeLocal();
  const state = await linked(remote, local);
  local.put("a.md", "2");
  local.put("new.md", "n");
  remote.failList = "offline";
  const { state: after, status } = await syncOnce(remote, local, state, NOW);
  expect(status).toMatchObject({ kind: "offline", waiting: 2 });
  expect(after).toEqual(state);
  remote.failList = undefined;
  await syncOnce(remote, local, after, NOW);
  expect(remote.get("a.md")).toBe("2");
  expect(remote.get("new.md")).toBe("n");
});

test("signed out stops the round and touches no local file", async () => {
  const remote = new FakeRemote({ "a.md": "1" });
  const local = new FakeLocal({ "b.md": "b" });
  remote.failList = "signed-out";
  const { status } = await syncOnce(remote, local, fresh(), NOW);
  expect(status).toMatchObject({ kind: "error", message: "Sign in again to keep syncing" });
  expect(local.writes).toEqual([]);
  expect(local.trashed).toEqual([]);
});

test("the folder is gone: an error, and nothing changes in the project", async () => {
  const remote = new FakeRemote({ "a.md": "1" });
  const local = new FakeLocal();
  const state = await linked(remote, local);
  local.missing = true;
  const { state: after, status } = await syncOnce(remote, local, state, NOW);
  expect(status).toMatchObject({ kind: "error", message: "Folder not found" });
  expect(after).toEqual(state);
  expect(remote.removed).toEqual([]);
});

test("read-only keeps local edits and still downloads", async () => {
  const remote = new FakeRemote({ "a.md": "1", "b.md": "1" });
  const local = new FakeLocal();
  const state = await linked(remote, local);
  remote.readOnly = true;
  local.put("a.md", "my edit");
  local.put("mine.md", "m");
  remote.put("b.md", "2");
  const { status } = await syncOnce(remote, local, state, NOW);
  expect(status.readOnly).toBe(true);
  expect(local.get("a.md")).toBe("my edit");
  expect(local.get("b.md")).toBe("2");
  expect(remote.get("a.md")).toBe("1");
});

test("busy mid-round keeps what wasn't done for the next round", async () => {
  const remote = new FakeRemote();
  const local = new FakeLocal({ "a.md": "a", "b.md": "b", "c.md": "c" });
  remote.failSaveAfter = { n: 1, kind: "busy" };
  const { state, status } = await syncOnce(remote, local, fresh(), NOW);
  expect(status.kind).toBe("error");
  expect(Object.keys(state.synced)).toHaveLength(1);
  remote.failSaveAfter = undefined;
  await syncOnce(remote, local, state, NOW);
  expect([...remote.files.keys()].sort()).toEqual(["a.md", "b.md", "c.md"]);
});

test("an edit during an upload is sent in the next round", async () => {
  const remote = new FakeRemote();
  const local = new FakeLocal({ "a.md": "v1" });
  local.afterRead = (p) => {
    local.afterRead = undefined;
    local.put(p, "v2");
  };
  const { state } = await syncOnce(remote, local, fresh(), NOW);
  expect(remote.get("a.md")).toBe("v1");
  await syncOnce(remote, local, state, NOW);
  expect(remote.get("a.md")).toBe("v2");
});

test("case-only differences are the same file", async () => {
  const remote = new FakeRemote({ "Readme.md": "same" });
  const local = new FakeLocal({ "README.md": "same" });
  const { status } = await syncOnce(remote, local, fresh(), NOW);
  expect(remote.saves).toEqual([]);
  expect(local.writes).toEqual([]);
  expect(status.conflicts).toEqual([]);
});

test("too-big local files and files the server refuses are skipped and listed", async () => {
  const remote = new FakeRemote();
  const local = new FakeLocal({ "ok.md": "ok", "secret.md": "s" });
  const big: LocalFile = { path: "video.mp4", hash: "x", size: 11 * 1024 * 1024 };
  const list = local.list.bind(local);
  local.list = async () => [...((await list()) as LocalFile[]), big];
  const save = remote.save.bind(remote);
  remote.save = async (p, d, b) => {
    if (p === "secret.md") throw new RemoteError("rejected", "This file contains a private key");
    return save(p, d, b);
  };
  const { status } = await syncOnce(remote, local, fresh(), NOW);
  expect(remote.get("ok.md")).toBe("ok");
  expect(status.skipped).toEqual([
    { path: "video.mp4", reason: "too big" },
    { path: "secret.md", reason: "This file contains a private key" },
  ]);
});

test("syncing reports how many files the round moves", async () => {
  const remote = new FakeRemote({ "a.md": "a", "b.md": "b" });
  const local = new FakeLocal({ "c.md": "c" });
  const seen: number[] = [];
  await syncOnce(remote, local, fresh(), NOW, (n) => seen.push(n));
  expect(seen).toEqual([3]);
});

test("confirmDeletes removes them in the project; restoreDeleted brings them back", async () => {
  const remote = new FakeRemote({ "a.md": "1", "b.md": "2" });
  const local = new FakeLocal();
  let state = await linked(remote, local);
  local.files.delete("a.md");
  local.files.delete("b.md");
  state = (await syncOnce(remote, local, state, NOW)).state;
  expect(state.deletedHere).toEqual(["a.md", "b.md"]);

  const restored = restoreDeleted(state);
  expect(restored.deletedHere).toEqual([]);
  state = (await syncOnce(remote, local, restored, NOW)).state;
  expect(local.get("a.md")).toBe("1");

  local.files.delete("a.md");
  local.files.delete("b.md");
  state = (await syncOnce(remote, local, state, NOW)).state;
  const after = await confirmDeletes(remote, state);
  expect(remote.removed).toEqual(["a.md", "b.md"]);
  expect(after).toEqual({ synced: {}, deletedHere: [] });
  expect((await syncOnce(remote, local, after, NOW)).status.deletedHere).toEqual([]);
});
