import assert from "node:assert/strict";
import { test } from "node:test";
import { splitSuggestion, visibleWhileStreaming } from "./suggest.ts";

const block = (v: unknown) => `\`\`\`json\n${JSON.stringify(v)}\n\`\`\``;

test("a trailing suggest block becomes a suggestion and leaves the text", () => {
  const reply = `Ines and Omar can run this.\n\n${block({ suggest: { goal: "Plan a launch campaign", hire: [{ role: "Marketing lead", department: "Marketing" }] } })}`;
  assert.deepEqual(splitSuggestion(reply), {
    text: "Ines and Omar can run this.",
    suggestion: { goal: "Plan a launch campaign", hire: [{ role: "Marketing lead", department: "Marketing" }], newProject: false, projectName: null },
  });
});

test("replies without a valid suggest block are left alone", () => {
  assert.deepEqual(splitSuggestion("Just an answer."), { text: "Just an answer.", suggestion: null });
  const code = "Here:\n```json\n{\"name\":\"x\"}\n```";
  assert.deepEqual(splitSuggestion(code), { text: code, suggestion: null });
  assert.deepEqual(splitSuggestion("Oops\n```json\n{\"suggest\": nope}\n```"), { text: "Oops", suggestion: null });
  assert.deepEqual(splitSuggestion(`Hire only.\n${block({ suggest: { hire: [{ role: "Designer" }, { role: "" }, { role: "a".repeat(200) }, { role: "Writer" }, { role: "Analyst" }] } })}`), {
    text: "Hire only.",
    suggestion: { goal: null, hire: [{ role: "Designer", department: null }, { role: "Writer", department: null }, { role: "Analyst", department: null }], newProject: false, projectName: null },
  });
  assert.deepEqual(splitSuggestion(`Empty.\n${block({ suggest: {} })}`), { text: "Empty.", suggestion: null });
});

test("a suggest block is hidden while it streams in", () => {
  assert.equal(visibleWhileStreaming("Omar can do it.\n\n```json\n{\"sugg"), "Omar can do it.");
  assert.equal(visibleWhileStreaming("Omar can do it.\n\n```"), "Omar can do it.");
  assert.equal(visibleWhileStreaming("Code:\n```ts\nconst a = 1;"), "Code:\n```ts\nconst a = 1;");
});

test("a suggestion can ask to build in a new project", () => {
  const reply = `Sana can build it.\n\n${block({ suggest: { goal: "Build a landing page", newProject: true, projectName: "Bakery site" } })}`;
  assert.deepEqual(splitSuggestion(reply).suggestion, { goal: "Build a landing page", hire: [], newProject: true, projectName: "Bakery site" });
});

test("a tool block being typed is hidden while streaming", () => {
  assert.equal(visibleWhileStreaming('Let me check.\n```json\n{"tool": "read_'), "Let me check.");
  assert.equal(visibleWhileStreaming('```json\n{"suggest'), "");
});
