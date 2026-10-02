import { expect, test } from "vitest";
import { getBlob, hashOf, isTextContent, putBlob } from "../src/files/store.js";

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
