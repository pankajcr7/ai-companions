import assert from "node:assert/strict";
import { test } from "node:test";
import { exclusionReason, normalizePath } from "./file-rules.ts";

test("browser rules match the server's on the key cases", () => {
  assert.equal(normalizePath("../x").ok, false);
  assert.equal(exclusionReason("app/node_modules/a.js", "file"), "node_modules folders are excluded");
  assert.equal(exclusionReason(".env.example", "file"), null);
  assert.equal(exclusionReason("keys/a.pem", "file"), "secret or credential file");
});
