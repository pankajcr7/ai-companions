import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { exclusionReason, normalizePath, parentDirs, PRIVATE_KEY } from "../src/files/rules.js";

test.each([
  ["src/app/page.tsx", "src/app/page.tsx"],
  ["./README.md", "README.md"],
  ["src\\win\\file.ts", "src/win/file.ts"],
  ["folder/", "folder"],
])("normalizePath(%s) -> %s", (raw, out) => {
  expect(normalizePath(raw)).toEqual({ ok: true, path: out });
});

test.each([
  ["", /empty/],
  ["../etc/passwd", /invalid/],
  ["a/../../b", /invalid/],
  ["a//b", /invalid/],
  ["/abs/path", /absolute/],
  ["C:/Windows/x", /absolute/],
  ["bad\u0000name", /control/],
  ["tab\tname", /control/],
  [`${"x".repeat(256)}.txt`, /too long/],
  [Array.from({ length: 33 }, () => "d").join("/"), /deep/],
  [`${"a/".repeat(520)}f`, /too long|deep/],
])("normalizePath rejects %j", (raw, reason) => {
  const r = normalizePath(raw);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toMatch(reason);
});

test.each([
  ["node_modules/react/index.js", "file", /node_modules/],
  ["app/.git/config", "file", /\.git/],
  ["web/.next/cache/x", "file", /\.next/],
  ["dist", "dir", /dist/],
  [".env", "file", /secret/],
  ["config/.env.production", "file", /secret/],
  ["keys/server.pem", "file", /secret/],
  ["home/id_rsa", "file", /secret/],
  ["home/id_ed25519.pub", "file", /secret/],
  [".npmrc", "file", /secret/],
  ["photos/.DS_Store", "file", /system/],
])("exclusionReason(%s) excludes", (path, kind, reason) => {
  expect(exclusionReason(path, kind as "file" | "dir")).toMatch(reason);
});

test.each([["src/index.ts"], [".env.example"], [".env.sample"], [".github/workflows/ci.yml"], ["package-lock.json"], [".eslintrc.json"]])(
  "exclusionReason(%s) keeps",
  (path) => {
    expect(exclusionReason(path, "file")).toBeNull();
  },
);

test("private key detection", () => {
  expect(PRIVATE_KEY.test("-----BEGIN RSA PRIVATE KEY-----\nMIIE")).toBe(true);
  expect(PRIVATE_KEY.test("-----BEGIN OPENSSH PRIVATE KEY-----")).toBe(true);
  expect(PRIVATE_KEY.test("-----BEGIN PUBLIC KEY-----")).toBe(false);
});

test("parentDirs lists every ancestor folder", () => {
  expect(parentDirs("a/b/c.txt")).toEqual(["a", "a/b"]);
  expect(parentDirs("top.txt")).toEqual([]);
});

test("the browser copy of the rules is identical to the server's", () => {
  const server = readFileSync(new URL("../src/files/rules.ts", import.meta.url), "utf8");
  const browser = readFileSync(new URL("../../frontend/src/lib/file-rules.ts", import.meta.url), "utf8");
  expect(browser).toBe(server);
});
