import { afterEach, expect, test } from "vitest";
import { decryptSecret, encryptSecret, SecretError } from "../src/crypto.js";

const original = process.env.CREDENTIALS_KEY;
afterEach(() => {
  process.env.CREDENTIALS_KEY = original;
});

test("round trip, and the stored form hides the secret", () => {
  const blob = encryptSecret("sk-live-1234567890");
  expect(blob.startsWith("v1:")).toBe(true);
  expect(blob).not.toContain("sk-live");
  expect(decryptSecret(blob)).toBe("sk-live-1234567890");
});

test("same secret encrypts differently each time", () => {
  expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
});

test("tampered ciphertext fails with SecretError", () => {
  const [v, iv, tag, ct] = encryptSecret("secret").split(":");
  const flipped = Buffer.from(ct, "base64");
  flipped[0] ^= 1;
  expect(() => decryptSecret([v, iv, tag, flipped.toString("base64")].join(":"))).toThrow(SecretError);
});

test("wrong key fails with SecretError", () => {
  const blob = encryptSecret("secret");
  process.env.CREDENTIALS_KEY = Buffer.alloc(32, 7).toString("base64");
  expect(() => decryptSecret(blob)).toThrow(SecretError);
});

test("missing or short key is a clear configuration error", () => {
  process.env.CREDENTIALS_KEY = "short";
  expect(() => encryptSecret("x")).toThrow(/CREDENTIALS_KEY/);
});
