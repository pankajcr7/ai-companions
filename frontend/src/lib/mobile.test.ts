import assert from "node:assert/strict";
import { test } from "node:test";
import { appName, appStatus, isActive } from "./mobile.ts";

test("app names drop the request prefix and stay short; statuses read plainly", () => {
  assert.equal(appName("Design a mobile app: A hiking trails app"), "A hiking trails app");
  assert.equal(appName("Make an iOS app for my bakery"), "Make an iOS app for my bakery");
  assert.equal(appName(`Design a mobile app: ${"x".repeat(80)}`), `${"x".repeat(57)}...`);
  assert.deepEqual(["planning", "awaiting_approval", "running", "reviewing", "done", "failed", "cancelled"].map(appStatus), ["Planning", "Ready to start", "Working", "Working", "Done", "Needs a fix", "Stopped"]);
  assert.deepEqual(["planning", "awaiting_approval", "running", "reviewing", "done", "failed", "cancelled"].map(isActive), [true, true, true, true, false, false, false]);
});
