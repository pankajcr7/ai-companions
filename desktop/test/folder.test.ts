import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { Folder, rev } from "../src/folder";

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

async function folder(files: Record<string, string | Buffer> = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "agent-folder-"));
  const root = path.join(base, "site");
  await fs.mkdir(root);
  for (const [p, d] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, p)), { recursive: true });
    await fs.writeFile(path.join(root, p), d);
  }
  const trashed: string[] = [];
  const f = new Folder(root, path.join(base, "versions"), async (abs) => {
    trashed.push(abs);
    await fs.rm(abs, { recursive: true });
  });
  return { root, f, trashed, disk: (p: string) => fs.readFile(path.join(root, p), "utf8") };
}

test("lists folders and files with sizes, hashes and text detection, skipping what never belongs", async () => {
  const { f } = await folder({ "src/app.ts": "a", "logo.png": Buffer.from([0x89, 0x50, 0, 1]), "node_modules/x.js": "x", ".git/HEAD": "h", ".env": "S=1", ".DS_Store": "" });
  const entries = await f.list();
  expect(entries.map((e) => [e.path, e.kind, e.isText]).sort()).toEqual([
    ["logo.png", "file", false],
    ["src", "dir", false],
    ["src/app.ts", "file", true],
  ]);
  expect(entries.find((e) => e.path === "src/app.ts")).toMatchObject({ size: 1, hash: sha("a") });
});

test("writes create files and folders, and refuse when the file changed since it was read", async () => {
  const { f, disk } = await folder({ "a.md": "one" });
  expect(await f.write("docs/new.md", Buffer.from("hi"), 0)).toBe(sha("hi"));
  expect(await disk("docs/new.md")).toBe("hi");
  await expect(f.write("a.md", Buffer.from("x"), 0)).rejects.toMatchObject({ code: "conflict" });
  await expect(f.write("a.md", Buffer.from("x"), rev(sha("something else")))).rejects.toMatchObject({ code: "conflict", message: expect.stringMatching(/changed since/) });
  expect(await f.write("a.md", Buffer.from("two"), rev(sha("one")))).toBe(sha("two"));
  expect(await disk("a.md")).toBe("two");
});

test("every overwrite keeps the old version, which can be read and restored", async () => {
  const { f, disk } = await folder({ "a.md": "one" });
  await f.write("a.md", Buffer.from("two"), rev(sha("one")));
  await f.write("a.md", Buffer.from("three"), rev(sha("two")));
  const versions = await f.versions("a.md");
  expect(versions).toHaveLength(2);
  expect((await f.version("a.md", versions[1].id)).toString()).toBe("one");
  expect(await f.restore("a.md", versions[1].id)).toBe(sha("one"));
  expect(await disk("a.md")).toBe("one");
  expect((await f.versions("a.md"))[0].size).toBe(5); // "three" was kept before the restore
});

test("remove goes to the trash; mkdir and move work inside the folder", async () => {
  const { root, f, trashed, disk } = await folder({ "a.md": "a", "old/b.md": "b" });
  await f.remove("a.md");
  expect(trashed).toEqual([path.join(root, "a.md")]);
  await f.mkdir("assets/img");
  expect((await fs.stat(path.join(root, "assets/img"))).isDirectory()).toBe(true);
  await f.move("old", "new");
  expect(await disk("new/b.md")).toBe("b");
  await expect(f.move("new/b.md", "assets")).rejects.toMatchObject({ code: "conflict" });
});

test("nothing outside the folder or behind a link is reachable", async () => {
  const { root, f } = await folder({ "a.md": "a" });
  const outside = path.join(path.dirname(root), "secret.txt");
  await fs.writeFile(outside, "secret");
  await fs.symlink(outside, path.join(root, "link.txt"));
  await fs.symlink(path.dirname(root), path.join(root, "up"));
  await expect(f.read("../secret.txt")).rejects.toMatchObject({ code: "invalid" });
  await expect(f.read("link.txt")).rejects.toMatchObject({ code: "invalid" });
  await expect(f.write("link.txt", Buffer.from("x"), 0)).rejects.toMatchObject({ code: "invalid" });
  await expect(f.write("up/escape.txt", Buffer.from("x"), 0)).rejects.toMatchObject({ code: "invalid" });
  await expect(f.read("node_modules/x.js")).rejects.toMatchObject({ code: "invalid" });
  expect((await f.list()).map((e) => e.path)).toEqual(["a.md"]);
  expect(await fs.readFile(outside, "utf8")).toBe("secret");
});

test("a missing folder says so and is never recreated", async () => {
  const { root, f } = await folder();
  await fs.rm(root, { recursive: true });
  await expect(f.list()).rejects.toMatchObject({ code: "not_found" });
  await expect(f.write("a.md", Buffer.from("x"), 0)).rejects.toMatchObject({ code: "not_found" });
  await expect(fs.stat(root)).rejects.toThrow();
});

test("two saves of the same file at once: one wins, the other is told the file changed", async () => {
  const { f, disk } = await folder({ "a.md": "original" });
  const base = rev(sha("original"));
  const results = await Promise.allSettled([f.write("a.md", Buffer.from("team"), base), f.write("a.md", Buffer.from("editor"), base)]);
  expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
  const won = results[0].status === "fulfilled" ? "team" : "editor";
  expect(await disk("a.md")).toBe(won);
  expect((await f.versions("a.md")).length).toBe(1);
});

test("files with very long names still keep their versions", async () => {
  const name = `${"文档".repeat(40)}.md`;
  const { f } = await folder({ [name]: "one" });
  await f.write(name, Buffer.from("two"), rev(sha("one")));
  expect((await f.version(name, (await f.versions(name))[0].id)).toString()).toBe("one");
});

test("a huge folder is listed up to 2,000 entries, and reads at the same moment share one walk", async () => {
  const files: Record<string, string> = {};
  for (let i = 0; i < 2100; i++) files[`f${i}.txt`] = `${i}`;
  const { f } = await folder(files);
  const [a, b] = await Promise.all([f.list(), f.list()]);
  expect(a).toHaveLength(2000);
  expect(b).toBe(a);
});
