import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, expect, test } from "vitest";
import { checkBaseUrl, guardedLookup, isPublicAddress, safeFetch, UnsafeUrlError } from "../src/safe-fetch.js";

beforeEach(() => {
  process.env.ALLOW_LOCAL_ENDPOINTS = "false";
});
afterEach(() => {
  process.env.ALLOW_LOCAL_ENDPOINTS = "true";
});

test.each([
  ["8.8.8.8", true],
  ["1.1.1.1", true],
  ["2606:4700:4700::1111", true],
  ["127.0.0.1", false],
  ["10.1.2.3", false],
  ["172.16.5.5", false],
  ["192.168.1.1", false],
  ["169.254.169.254", false],
  ["100.64.0.1", false],
  ["0.0.0.0", false],
  ["::1", false],
  ["fd00::1", false],
  ["fe80::1", false],
  ["::ffff:127.0.0.1", false],
  ["::ffff:7f00:1", false],
  ["not-an-ip", false],
])("isPublicAddress(%s) = %s", (ip, expected) => {
  expect(isPublicAddress(ip)).toBe(expected);
});

test("checkBaseUrl accepts public https and normalises the trailing slash", () => {
  expect(checkBaseUrl("https://openrouter.ai/api/v1/")).toBe("https://openrouter.ai/api/v1");
});

test.each([
  ["http://example.com/v1", "https://"],
  ["https://user:pw@example.com", "username"],
  ["https://127.0.0.1/v1", "private"],
  ["https://[::1]/v1", "private"],
  ["https://169.254.169.254/latest", "private"],
  ["https://localhost:8080", "private"],
  ["not a url", "valid URL"],
])("checkBaseUrl rejects %s", (url, msg) => {
  expect(() => checkBaseUrl(url)).toThrow(UnsafeUrlError);
  expect(() => checkBaseUrl(url)).toThrow(new RegExp(msg, "i"));
});

test("ALLOW_LOCAL_ENDPOINTS=true permits http and local addresses", () => {
  process.env.ALLOW_LOCAL_ENDPOINTS = "true";
  expect(checkBaseUrl("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434/v1");
});

test("the connect-time lookup refuses hostnames that resolve to private addresses", async () => {
  await expect(
    new Promise((resolve, reject) => guardedLookup("localhost", { all: true }, (err, addrs) => (err ? reject(err) : resolve(addrs)))),
  ).rejects.toThrow(UnsafeUrlError);
});

test("redirects are refused", async () => {
  process.env.ALLOW_LOCAL_ENDPOINTS = "true";
  const server = createServer((_req, res) => res.writeHead(302, { location: "http://169.254.169.254/" }).end());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  await expect(safeFetch(`http://127.0.0.1:${port}/models`)).rejects.toThrow();
  server.close();
});
