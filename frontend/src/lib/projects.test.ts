import assert from "node:assert/strict";
import { test } from "node:test";
import { restorePrompt, uploadBatches, type Plan } from "./projects.ts";

const file = (name: string) => new File(["x"], name);
const plan = (n: number): Plan => ({ included: Array.from({ length: n }, (_, i) => ({ path: `p/f${i}.txt`, file: file(`f${i}.txt`) })), excluded: [], dirs: [], bytes: n });

test("restoring over unsaved edits says they will be replaced", () => {
  assert.match(restorePrompt(3, true), /unsaved changes will be replaced/);
  assert.match(restorePrompt(3, false), /nothing is lost/);
  assert.doesNotMatch(restorePrompt(3, true), /nothing is lost/);
});

test("a new-project upload that fails after the first batch reports the failure so the project is removed", async () => {
  const calls: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body });
    if (url.endsWith("/projects/upload")) return Response.json({ projectId: "p1", importId: "i1", added: 100, skipped: [] });
    if (url.endsWith("/p1/upload")) return Response.json({ error: { message: "Too many requests" } }, { status: 429 });
    if (url.endsWith("/finish")) return Response.json({ deletedProject: true });
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  await assert.rejects(
    uploadBatches({ workspaceId: "w", name: "N", source: "folder", plan: plan(150), onProgress: () => {}, isCancelled: () => false }),
    /Too many requests.*nothing was kept/,
  );
  const finish = calls.find((c) => c.url.endsWith("/imports/i1/finish"));
  assert.ok(finish, "finish was called");
  assert.deepEqual(JSON.parse(String(finish.body)), { status: "failed" });
});
