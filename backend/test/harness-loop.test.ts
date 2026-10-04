import { expect, test } from "vitest";
import { z } from "zod";
import type { Call } from "../src/goals/llm.js";
import { parseToolCall, runLoop, ToolError, trimToolResults, TOOL_RESULT, type CallModel, type Tool } from "../src/harness/loop.js";

const actor = { id: "a", name: "A", kind: "ai", status: "active", model: "m", connection: null };
const fence = (v: unknown) => `\`\`\`json\n${JSON.stringify(v)}\n\`\`\``;
const call = (text: string): Call => ({ text, model: "m", inputTokens: 1, outputTokens: 1 });
/** A model that replies from a list, recording what it was sent. */
function scripted(replies: string[]) {
  const seen: { instructions: string; turns: { role: string; content: string }[] }[] = [];
  const model: CallModel = async (instructions, turns) => {
    seen.push({ instructions, turns: turns.map((t) => ({ ...t })) });
    return call(replies.shift() ?? "final");
  };
  return { model, seen };
}
const echo: Tool<{ word: string }> = { name: "echo", purpose: "Repeats a word.", argsHelp: '{"word": string}', args: z.object({ word: z.string() }), label: (a) => a.word, run: async (a) => `echo ${a.word}` };
const run = (tools: Tool[], replies: string[], limit = 3, signal = new AbortController().signal) => {
  const s = scripted(replies);
  return { s, done: runLoop({ actor, instructions: "BASE", turns: [{ role: "user", content: "hi" }], tools, limit, signal, callModel: s.model }) };
};

test("tool blocks are read even when their strings hold braces and fences", () => {
  expect(parseToolCall(`Let me look.\n${fence({ tool: "read_file", args: { path: "a {b} ```c```" } })}`)).toEqual({ name: "read_file", args: { path: "a {b} ```c```" } });
  expect(parseToolCall("Just an answer with {braces}.")).toBeNull();
  expect(parseToolCall('Broken: {"tool": "x", "args": {')).toMatchObject({ bad: expect.any(String) });
  expect(parseToolCall('{"tool": 5}')).toMatchObject({ bad: expect.any(String) });
});

test("no tools: one call, the reply is the answer, no protocol appended", async () => {
  const { s, done } = run([], ["Hello."]);
  expect((await done).text).toBe("Hello.");
  expect(s.seen[0].instructions).toBe("BASE");
});

test("a tool call runs, its result goes back, and the next reply is the answer", async () => {
  const { s, done } = run([echo], [fence({ tool: "echo", args: { word: "hi" } }), "The answer."]);
  const r = await done;
  expect(r.text).toBe("The answer.");
  expect(r.toolUses).toMatchObject([{ name: "echo", label: "hi", ok: true }]);
  expect(s.seen[0].instructions).toContain("TOOLS:");
  expect(s.seen[0].instructions).toContain("- echo: Repeats a word.");
  expect(s.seen[1].turns.at(-1)!.content).toBe(`${TOOL_RESULT}echo hi:\necho hi`);
  expect(r.calls).toHaveLength(2);
});

test("a done block ends the loop and is removed from the answer", async () => {
  const { done } = run([echo], [`All set.\n${fence({ done: true })}`]);
  expect((await done).text).toBe("All set.");
});

test("the same call twice in a row is not run again", async () => {
  const runs: string[] = [];
  const counted: Tool<{ word: string }> = { ...echo, run: async (a) => (runs.push(a.word), "ok") };
  const again = fence({ tool: "echo", args: { word: "x" } });
  const { s, done } = run([counted], [again, again, "Done."]);
  await done;
  expect(runs).toEqual(["x"]);
  expect(s.seen[2].turns.at(-1)!.content).toContain("You already did exactly that");
});

test("bad calls get an explanation; three in a row end the loop", async () => {
  const { s, done } = run([echo], [fence({ tool: "nope", args: {} }), fence({ tool: "echo", args: { word: 1 } }), "Text before.\n" + fence({ tool: "nope", args: {} }), "never"]);
  const r = await done;
  expect(s.seen[1].turns.at(-1)!.content).toContain("Valid tools: echo");
  expect(s.seen[2].turns.at(-1)!.content).toContain("Wrong arguments for echo");
  expect(r.text).toBe("Text before.");
  expect(r.calls).toHaveLength(3);
});

test("after the limit the model must answer; a tool block then is stripped (forced answer strips the tool block)", async () => {
  const t = (w: string) => fence({ tool: "echo", args: { word: w } });
  const { s, done } = run([echo], [t("a"), t("b"), `Final words.\n${t("c")}`], 2);
  const r = await done;
  expect(r.toolUses.map((u) => u.label)).toEqual(["a", "b"]);
  expect(s.seen[2].turns.at(-1)!.content).toContain("No more tools. Give your final answer now.");
  expect(r.text).toBe("Final words.");
});

test("a tool error is shown to the model, other failures say the tool failed", async () => {
  const failing: Tool<{ word: string }> = { ...echo, run: async (a) => { if (a.word === "user") throw new ToolError("No such file."); throw new Error("boom"); } };
  const { s, done } = run([failing], [fence({ tool: "echo", args: { word: "user" } }), fence({ tool: "echo", args: { word: "other" } }), "ok"]);
  const r = await done;
  expect(s.seen[1].turns.at(-1)!.content).toContain("No such file.");
  expect(s.seen[2].turns.at(-1)!.content).toContain("The tool failed.");
  expect(r.toolUses.map((u) => u.ok)).toEqual([false, false]);
});

test("abort during a tool ends the loop at once", async () => {
  const ac = new AbortController();
  const slow: Tool<{ word: string }> = { ...echo, run: (_a, signal) => new Promise((_r, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))) };
  const { done } = run([slow], [fence({ tool: "echo", args: { word: "x" } }), "never"], 3, ac.signal);
  setTimeout(() => ac.abort(), 50);
  await expect(done).rejects.toMatchObject({ code: "aborted" });
});

test("old tool results are shortened once the conversation is over budget, keeping the latest two", () => {
  const big = "x".repeat(30_000);
  const turns = [
    { role: "user" as const, content: "start" },
    ...[1, 2, 3, 4].flatMap((i) => [{ role: "assistant" as const, content: `call ${i}` }, { role: "user" as const, content: `${TOOL_RESULT}read_file f${i}.ts:\n${big}` }]),
  ];
  const out = trimToolResults(turns, 60_000);
  expect(out[2].content).toBe("[read_file f1.ts: " + turns[2].content.length + " characters, shown earlier]");
  expect(out[4].content).toMatch(/^\[read_file f2\.ts/);
  expect(out[6].content).toBe(turns[6].content);
  expect(out[8].content).toBe(turns[8].content);
  expect(trimToolResults(turns.slice(0, 3), 60_000)).toEqual(turns.slice(0, 3));
});
