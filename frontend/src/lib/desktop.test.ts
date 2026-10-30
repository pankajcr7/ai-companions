import assert from "node:assert/strict";
import { test } from "node:test";
import { statusNotes, statusText, type SyncStatus } from "./desktop.ts";

const NOW = 10_000_000;
const s = (o: Partial<SyncStatus>): SyncStatus => ({ kind: "synced", at: NOW, waiting: 0, conflicts: [], deletedHere: [], skipped: [], readOnly: false, ...o });

test("the main sync line", () => {
  assert.equal(statusText(s({}), NOW + 20_000), "Synced just now");
  assert.equal(statusText(s({}), NOW + 3 * 60_000 + 5_000), "Synced 3 minutes ago");
  assert.equal(statusText(s({}), NOW + 60_000), "Synced 1 minute ago");
  assert.equal(statusText(s({ kind: "syncing", waiting: 4 }), NOW), "Syncing 4 files…");
  assert.equal(statusText(s({ kind: "syncing", waiting: 1 }), NOW), "Syncing 1 file…");
  assert.equal(statusText(s({ kind: "offline", waiting: 2 }), NOW), "Offline: 2 changes waiting");
  assert.equal(statusText(s({ kind: "offline", waiting: 0 }), NOW), "Offline");
  assert.equal(statusText(s({ kind: "error", message: "Folder not found" }), NOW), "Folder not found");
});

test("what needs the owner's attention", () => {
  assert.deepEqual(statusNotes(s({})), []);
  assert.deepEqual(statusNotes(s({ readOnly: true })), ["You can view this project; your changes stay on this computer."]);
  assert.deepEqual(statusNotes(s({ conflicts: ["a (my copy).md"] })), ["1 conflict: a (my copy).md"]);
  assert.deepEqual(statusNotes(s({ conflicts: ["a (my copy).md", "b (my copy).md"] })), ["2 conflicts: a (my copy).md, b (my copy).md"]);
  assert.deepEqual(statusNotes(s({ deletedHere: ["a.md"] })), ["1 file deleted on this computer"]);
  assert.deepEqual(statusNotes(s({ deletedHere: ["a.md", "b.md", "c.md"] })), ["3 files deleted on this computer"]);
  assert.deepEqual(statusNotes(s({ skipped: [{ path: "video.mp4", reason: "too big" }] })), ["video.mp4 skipped: too big"]);
  const many = ["a", "b", "c", "d", "e"].map((p) => ({ path: p, reason: "too big" }));
  assert.deepEqual(statusNotes(s({ skipped: many })), ["a skipped: too big", "b skipped: too big", "c skipped: too big", "and 2 more skipped"]);
});
