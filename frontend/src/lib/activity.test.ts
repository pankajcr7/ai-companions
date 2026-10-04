import assert from "node:assert/strict";
import { test } from "node:test";
import { activitySummary, liveLabel } from "./activity.ts";

const u = (name: string, label = "x", ok = true) => ({ name, label, ok, ms: 1, chars: 1 });

test("the activity line counts reads, searches, pages, and suggestions in plain words", () => {
  assert.equal(activitySummary([u("read_file"), u("read_file", "b"), u("list_files"), u("search"), u("open_url"), u("web_search")], 2), "Read 2 files · Looked through files · Searched 1 time · Searched the web 1 time · Opened 1 page · 2 suggested changes");
  assert.equal(activitySummary([u("read_file")], 0), "Read 1 file");
  assert.equal(activitySummary([], 1), "1 suggested change");
  assert.equal(activitySummary([], 0), "");
});

test("live labels say what's happening now", () => {
  assert.equal(liveLabel({ name: "read_file", label: "src/app.ts" }), "📄 Reading src/app.ts…");
  assert.equal(liveLabel({ name: "search", label: "“login”" }), "🔍 Searching “login”…");
  assert.equal(liveLabel({ name: "open_url", label: "example.com" }), "🌐 Opening example.com…");
  assert.equal(liveLabel({ name: "web_search", label: "“bread”" }), "🌐 Searching the web for “bread”…");
  assert.equal(liveLabel({ name: "write_file", label: "index.html" }), "✏️ Writing index.html…");
  assert.equal(liveLabel({ name: "list_files", label: "project" }), "📁 Looking through project…");
});
