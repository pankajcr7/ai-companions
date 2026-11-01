import assert from "node:assert/strict";
import { test } from "node:test";
import { folderName } from "./desktop.ts";

test("a folder's name from its path on Mac or Windows, fitting a project name", () => {
  assert.equal(folderName("/Users/me/Sites/bakery-site"), "bakery-site");
  assert.equal(folderName("C:\\Users\\me\\Documents\\Shop\\"), "Shop");
  assert.equal(folderName("/"), "Folder");
  assert.equal(folderName(`/x/${"a".repeat(80)}`), "a".repeat(56));
});
