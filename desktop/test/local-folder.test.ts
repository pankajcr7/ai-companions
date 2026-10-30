import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { LocalFolder } from "../src/sync/local-folder";

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

async function folder(files: Record<string, string> = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-sync-"));
  for (const [p, d] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, p)), { recursive: true });
    await fs.writeFile(path.join(root, p), d);
  }
  const trashed: string[] = [];
  const local = new LocalFolder(root, async (abs) => {
    trashed.push(abs);
    await fs.rm(abs);
  });
  return { root, local, trashed };
}

test("lists files with hashes and sizes, skipping what never syncs", async () => {
  const { local } = await folder({
    "src/app.ts": "a",
    "README.md": "readme",
    ".env.example": "X=",
    "node_modules/x/index.js": "x",
    ".git/HEAD": "ref",
    ".next/cache.json": "{}",
    "dist/out.js": "o",
    "build/b.js": "b",
    "web/coverage/c.json": "{}",
    ".DS_Store": "",
    "Thumbs.db": "",
    "~$report.docx": "",
    "notes.md.swp": "",
    ".~lock.sheet.ods#": "",
    ".env": "SECRET=1",
    "id_rsa": "k",
    "certs/server.pem": "k",
  });
  const listed = await local.list();
  expect(listed).not.toBe("missing");
  expect((listed as { path: string }[]).map((f) => f.path).sort()).toEqual([".env.example", "README.md", "src/app.ts"]);
  expect((listed as { path: string; hash: string; size: number }[]).find((f) => f.path === "README.md")).toEqual({ path: "README.md", hash: sha("readme"), size: 6 });
});

test("writes create parent folders and return the hash; read, copy and trash", async () => {
  const { root, local, trashed } = await folder({ "a.md": "a" });
  expect(await local.write("deep/er/b.png", Buffer.from([1, 2, 3]))).toBe(sha(Buffer.from([1, 2, 3])));
  expect([...(await fs.readFile(path.join(root, "deep/er/b.png")))]).toEqual([1, 2, 3]);
  expect((await local.read("a.md")).toString()).toBe("a");
  await local.copy("a.md", "a (my copy).md");
  expect(await fs.readFile(path.join(root, "a (my copy).md"), "utf8")).toBe("a");
  await local.trash("a.md");
  expect(trashed).toEqual([path.join(root, "a.md")]);
});

test("a changed file gets a new hash", async () => {
  const { root, local } = await folder({ "a.md": "one" });
  await local.list();
  await fs.writeFile(path.join(root, "a.md"), "two!");
  const listed = (await local.list()) as { path: string; hash: string }[];
  expect(listed[0].hash).toBe(sha("two!"));
});

test("paths can't leave the folder", async () => {
  const { local } = await folder();
  await expect(local.write("../escape.txt", Buffer.from("x"))).rejects.toThrow();
  await expect(local.read("a/../../etc/passwd")).rejects.toThrow();
});

test("a missing folder says so", async () => {
  const { root, local } = await folder();
  await fs.rm(root, { recursive: true });
  expect(await local.list()).toBe("missing");
});
