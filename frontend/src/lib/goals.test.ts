import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCommand, pendingChanges, planSentence, removeTask, type DraftTask, type EditDTO } from "./goals.ts";

test("chat: sends to Nova's chat; everything else is a goal", () => {
  assert.deepEqual(parseCommand("  chat: hello Nova "), { kind: "chat", text: "hello Nova" });
  assert.deepEqual(parseCommand("CHAT:hi"), { kind: "chat", text: "hi" });
  assert.deepEqual(parseCommand("Launch the site"), { kind: "goal", text: "Launch the site" });
});

test("removing a task renumbers dependencies", () => {
  const t = (dependsOn: number[]): DraftTask => ({ agentId: "a", title: "t", instructions: "i", deliverable: "d", criteria: ["c"], dependsOn });
  const out = removeTask([t([]), t([0]), t([0, 1]), t([2])], 1);
  assert.deepEqual(out.map((x) => x.dependsOn), [[], [0], [1]]);
});

test("plan rows read as plain sentences", () => {
  assert.equal(planSentence("Lina", "Design the landing page"), "Lina will design the landing page");
  assert.equal(planSentence("Sana", "API docs"), "Sana will work on: API docs");
  assert.equal(planSentence("Omar", "write 7 posts"), "Omar will write 7 posts");
});

test("pending changes are counted so the card can say they're waiting", () => {
  const e = (status: EditDTO["status"], taskId = "t1"): EditDTO => ({ id: Math.random().toString(), taskId, path: "a", baseRevision: 1, note: "", status, reason: null });
  assert.deepEqual(pendingChanges({ edits: [e("pending"), e("applied"), e("pending", "t2"), e("stale")] }), { count: 2, firstTaskId: "t1" });
  assert.deepEqual(pendingChanges({ edits: [e("applied")] }), { count: 0, firstTaskId: null });
});
