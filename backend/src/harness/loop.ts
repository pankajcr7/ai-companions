import type { z } from "zod";
import { findJsonBlock } from "../goals/json-block.js";
import { CallError, complete, type Actor, type Call, type StepLog } from "../goals/llm.js";
import { sizeOf, textOf, type ChatTurn, type Part } from "../providers/types.js";

export type ToolUse = { name: string; label: string; ok: boolean; ms: number; chars: number };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
/** finishOnStop: a tool that saves something runs to completion on Stop, so whatever it saved is still recorded. */
/** What a tool returns: text, or text plus pictures (e.g. an image file) for models that can see. */
export type ToolOutput = { text: string; images: { mime: string; data: string }[] };
export type Tool<A = any> = { name: string; purpose: string; argsHelp: string; args: z.ZodType<A>; label: (a: A) => string; run: (a: A, signal: AbortSignal) => Promise<string | ToolOutput>; finishOnStop?: boolean };
/** reset: the text streamed so far was a tool call, not part of the answer. */
export type LoopEvent = { type: "delta"; text: string } | { type: "tool"; name: string; label: string } | { type: "reset" };
export type CallModel = (instructions: string, turns: ChatTurn[], onDelta?: (t: string) => void) => Promise<Call>;

/** A problem the model can fix (missing file, bad address): its message goes back to the model as the tool result. */
export class ToolError extends Error {}

export const TOOL_RESULT = "TOOL RESULT ";
export const TOOL_TIMEOUT_MS = 20_000;
export const CONTEXT_BUDGET = 60_000;
const MAX_BAD = 3;

function protocol(tools: Tool[], limit: number) {
  return [
    "TOOLS: before answering you can use these tools. To use one, reply with only this JSON block and nothing after it:",
    '```json\n{"tool":"<name>","args":{}}\n```',
    `The result arrives in the next message. One tool per reply, at most ${limit} uses. When you have what you need, reply normally with your answer and no tool block.`,
    ...tools.map((t) => `- ${t.name}: ${t.purpose} Args: ${t.argsHelp}`),
  ].join("\n");
}

/** The tool call in a reply: null means the reply is an answer; { bad } means an attempted call that can't be used. */
export function parseToolCall(text: string): { name: string; args: unknown } | { bad: string } | null {
  const block = findJsonBlock(text, "tool");
  if (!block) return /\{\s*"tool"\s*:/.test(text) ? { bad: "That tool call isn't valid JSON or was cut off." } : null;
  const v = block.value as { tool?: unknown; args?: unknown };
  if (typeof v.tool !== "string") return { bad: '"tool" must be the name of a tool.' };
  return { name: v.tool, args: v.args ?? {} };
}

const without = (text: string, key: string) => {
  const b = findJsonBlock(text, key);
  return (b ? text.slice(0, b.start) + text.slice(b.end) : text).trim();
};

/** The part of a reply worth showing: everything before a tool call, complete or half-typed. */
export function visibleAnswer(text: string): string {
  const last = [...text.matchAll(/\{\s*"tool"\s*:/g)].at(-1);
  return last ? text.slice(0, last.index).replace(/```[a-zA-Z]*\s*$/, "").trim() : text;
}

const answerAfterTools = (text: string, uses: ToolUse[]) =>
  visibleAnswer(without(text, "tool")) || `I ran out of steps before finishing. What I did: ${uses.map((u) => `${u.name} ${u.label}`).join(", ") || "nothing yet"}.`;

/** Shortens all but the latest two tool results, oldest first, until the conversation fits the budget. */
export function trimToolResults(turns: ChatTurn[], budget = CONTEXT_BUDGET): ChatTurn[] {
  let size = turns.reduce((n, t) => n + sizeOf(t.content), 0);
  if (size <= budget) return turns;
  const results = turns.flatMap((t, i) => (t.role === "user" && textOf(t.content).startsWith(TOOL_RESULT) ? [i] : []));
  const out = [...turns];
  for (const i of results.slice(0, -2)) {
    if (size <= budget) break;
    const text = textOf(out[i].content);
    const head = text.slice(TOOL_RESULT.length).split("\n", 1)[0].replace(/:$/, "");
    const short = `[${head}: ${text.length} characters, shown earlier]`;
    size -= sizeOf(out[i].content) - short.length;
    out[i] = { role: "user", content: short };
  }
  return out;
}

async function runTool(tool: Tool, args: unknown, signal: AbortSignal): Promise<{ ok: boolean; text: string; images: ToolOutput["images"] }> {
  const timeout = AbortSignal.timeout(TOOL_TIMEOUT_MS);
  const stopper = tool.finishOnStop ? timeout : AbortSignal.any([signal, timeout]);
  const stopped = new Promise<never>((_r, reject) => stopper.addEventListener("abort", () => reject(stopper.reason), { once: true }));
  try {
    const out = await Promise.race([tool.run(args, stopper), stopped]);
    if (signal.aborted) throw new CallError("aborted", "Stopped");
    return typeof out === "string" ? { ok: true, text: out, images: [] } : { ok: true, ...out };
  } catch (e) {
    if (signal.aborted) throw new CallError("aborted", "Stopped");
    if (timeout.aborted) return { ok: false, text: "That took too long and was stopped.", images: [] };
    if (e instanceof ToolError) return { ok: false, text: e.message, images: [] };
    console.error("tool", tool.name, e);
    return { ok: false, text: "The tool failed.", images: [] };
  }
}

/** Calls the model until it answers without a tool block, running one tool per round within the limits. */
export async function runLoop(o: { actor: Actor; instructions: string; turns: ChatTurn[]; tools: Tool[]; limit: number; signal: AbortSignal; log?: StepLog; onEvent?: (e: LoopEvent) => void; onCall?: (c: Call) => void; callModel?: CallModel }) {
  const callModel: CallModel = o.callModel ?? ((instructions, turns, onDelta) => complete(o.actor, instructions, turns, o.signal, o.log, onDelta));
  const instructions = o.tools.length ? `${o.instructions}\n\n${protocol(o.tools, o.limit)}` : o.instructions;
  const byName = new Map(o.tools.map((t) => [t.name, t]));
  const turns = [...o.turns];
  const calls: Call[] = [];
  const toolUses: ToolUse[] = [];
  let bad = 0;
  let lastKey = "";
  for (;;) {
    const c = await callModel(instructions, trimToolResults(turns), (text) => o.onEvent?.({ type: "delta", text }));
    calls.push(c);
    o.onCall?.(c);
    turns.push({ role: "assistant", content: c.text });
    const parsed = o.tools.length ? parseToolCall(c.text) : null;
    if (!parsed) return { text: without(c.text, "done"), calls, toolUses, turns };
    if (toolUses.length >= o.limit) return { text: answerAfterTools(c.text, toolUses), calls, toolUses, turns };

    let head = "error";
    let result: string;
    let images: ToolOutput["images"] = [];
    const tool = "bad" in parsed ? undefined : byName.get(parsed.name);
    const args = tool && !("bad" in parsed) ? tool.args.safeParse(parsed.args) : undefined;
    if ("bad" in parsed) result = `${parsed.bad} Valid tools: ${[...byName.keys()].join(", ")}.`;
    else if (!tool) result = `There is no tool called "${parsed.name}". Valid tools: ${[...byName.keys()].join(", ")}.`;
    else if (!args?.success) result = `Wrong arguments for ${tool.name}: ${args?.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ")}. Args: ${tool.argsHelp}`;
    else {
      const key = JSON.stringify([tool.name, parsed.args]);
      const label = tool.label(args.data);
      head = `${tool.name} ${label}`;
      if (key === lastKey) result = "You already did exactly that. Change approach or give your answer.";
      else {
        lastKey = key;
        o.onEvent?.({ type: "tool", name: tool.name, label });
        const started = Date.now();
        const r = await runTool(tool, args.data, o.signal);
        toolUses.push({ name: tool.name, label, ok: r.ok, ms: Date.now() - started, chars: r.text.length });
        result = r.text;
        images = r.images;
        bad = 0;
      }
    }
    if (result.startsWith("You already did") || head === "error") bad++;
    if (bad >= MAX_BAD) return { text: answerAfterTools(c.text, toolUses), calls, toolUses, turns };
    o.onEvent?.({ type: "reset" });
    const last = toolUses.length >= o.limit ? "\n\nNo more tools. Give your final answer now." : "";
    const resultText = `${TOOL_RESULT}${head}:\n${result}${last}`;
    turns.push({ role: "user", content: images.length ? [{ type: "text", text: resultText }, ...images.map((i): Part => ({ type: "image", ...i }))] : resultText });
  }
}
