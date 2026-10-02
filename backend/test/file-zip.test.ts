import { strToU8, zipSync } from "fflate";
import { expect, test } from "vitest";
import { readZip, writeZip, ZipLimitError } from "../src/files/zip.js";

const small = { maxEntries: 5, maxTotalBytes: 1000, maxFileBytes: 400 };

test("reads files, nested paths, empty files, and empty folders", () => {
  const zip = Buffer.from(zipSync({ "app/src/a.ts": strToU8("export {}"), "app/empty.txt": new Uint8Array(), "app/docs/": new Uint8Array() }));
  const out = readZip(zip, small);
  expect(out.map((e) => [e.path, e.isDir, e.data.toString()])).toEqual([
    ["app/src/a.ts", false, "export {}"],
    ["app/empty.txt", false, ""],
    ["app/docs/", true, ""],
  ]);
});

test("a file that expands past the per-file limit is refused (bomb-safe)", () => {
  const zip = Buffer.from(zipSync({ "big.bin": new Uint8Array(5000) }, { level: 9 }));
  expect(zip.length).toBeLessThan(400);
  expect(() => readZip(zip, small)).toThrow(ZipLimitError);
  expect(() => readZip(zip, small)).toThrow(/larger than/);
});

test("total expanded size is limited", () => {
  const files = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`f${i}.bin`, new Uint8Array(300)]));
  expect(() => readZip(Buffer.from(zipSync(files)), small)).toThrow(/expands to more than/);
});

test("too many entries is refused", () => {
  const files = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`f${i}.txt`, strToU8("x")]));
  expect(() => readZip(Buffer.from(zipSync(files)), small)).toThrow(/more than 5/);
});

test("a corrupt file is a clear error", () => {
  expect(() => readZip(Buffer.from("PK\u0003\u0004not really a zip at all"), small)).toThrow(ZipLimitError);
});

test("writeZip round-trips through readZip", () => {
  const buf = writeZip([
    { path: "a/b.txt", data: Buffer.from("hello"), isDir: false },
    { path: "a/empty", isDir: true },
  ]);
  const back = readZip(buf, small);
  expect(back.find((e) => e.path === "a/b.txt")!.data.toString()).toBe("hello");
  expect(back.some((e) => e.path === "a/empty/" && e.isDir)).toBe(true);
});
