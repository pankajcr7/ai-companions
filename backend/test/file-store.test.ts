import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { getBlob, hashOf, isTextContent, putBlob } from "../src/files/store.js";

const dirs: string[] = [];
const freshDisk = async () => {
  const dir = await mkdtemp(join(tmpdir(), "blobs-"));
  dirs.push(dir);
  process.env.FILES_DIR = dir;
  return dir;
};
afterAll(async () => {
  delete process.env.FILES_DIR;
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

test("put then get returns the same bytes, named by hash", async () => {
  const buf = Buffer.from(`hello ${Date.now()}`);
  const hash = await putBlob(buf);
  expect(hash).toBe(hashOf(buf));
  expect(hash).toMatch(/^[0-9a-f]{64}$/);
  expect((await getBlob(hash)).equals(buf)).toBe(true);
  expect(await putBlob(buf)).toBe(hash);
});

test("getBlob refuses anything that isn't a hash", async () => {
  await expect(getBlob("../../etc/passwd")).rejects.toThrow();
});

test("text detection", () => {
  expect(isTextContent(Buffer.from("const x = 1;\n"))).toBe(true);
  expect(isTextContent(Buffer.from("héllo ✓", "utf8"))).toBe(true);
  expect(isTextContent(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]))).toBe(false);
  expect(isTextContent(Buffer.from([0xff, 0xfe, 0xfd]))).toBe(false);
  expect(isTextContent(Buffer.alloc(0))).toBe(true);
});

test("a stored file survives the server's disk being wiped (free hosts wipe it on every restart)", async () => {
  const disk = await freshDisk();
  const buf = Buffer.from(`survives ${Date.now()}`);
  const hash = await putBlob(buf);
  await rm(disk, { recursive: true, force: true });
  expect((await getBlob(hash)).equals(buf)).toBe(true);
});

test("files saved on disk before contents moved to the database can still be read", async () => {
  const disk = await freshDisk();
  const buf = Buffer.from(`saved on disk ${Date.now()}`);
  const hash = hashOf(buf);
  await mkdir(join(disk, hash.slice(0, 2)), { recursive: true });
  await writeFile(join(disk, hash.slice(0, 2), hash), buf);
  expect((await getBlob(hash)).equals(buf)).toBe(true);
});
