import assert from "node:assert/strict";
import { test } from "node:test";
import { replyArrived } from "./chat.ts";

const msg = (id: string, role: "user" | "assistant") => ({ id, role, content: "", status: "complete" as const, model: null, inputTokens: null, outputTokens: null, errorCode: null, errorMessage: null, createdAt: "" });

test("not arrived while the newest message is still the old reply", () => {
  assert.equal(replyArrived([msg("u1", "user"), msg("a1", "assistant")], "a1"), false);
});

test("not arrived when only the user's message has been saved", () => {
  assert.equal(replyArrived([msg("a1", "assistant"), msg("u2", "user")], "a1"), false);
});

test("arrived in a capped 50-message history where the count never grows", () => {
  const before = Array.from({ length: 50 }, (_, i) => msg(`m${i}`, i % 2 ? "assistant" : "user"));
  const after = [...before.slice(2), msg("u-new", "user"), msg("a-new", "assistant")];
  assert.equal(after.length, 50);
  assert.equal(replyArrived(after, "m49"), true);
});

test("arrived in an empty thread", () => {
  assert.equal(replyArrived([msg("u1", "user"), msg("a1", "assistant")], null), true);
});
