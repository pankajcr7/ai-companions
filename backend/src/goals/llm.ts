import type { z } from "zod";
import { SecretError } from "../crypto.js";
import { clientFor, type ConnectionLike } from "../providers/index.js";
import { ProviderError, type ChatTurn, type StreamEvent } from "../providers/types.js";
import { extractJson } from "./plan.js";

export type Actor = { id: string; name: string; kind: string; status: string; model: string | null; connection: (ConnectionLike & { status: string }) | null };
export type Call = { text: string; model: string; inputTokens: number | null; outputTokens: number | null };
export type StepLog = (s: { agentId: string; model: string; inputTokens: number | null; outputTokens: number | null; ms: number; errorCode: string | null }) => Promise<void>;

export class CallError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function readiness(a: Actor): string | null {
  if (a.kind !== "ai") return `${a.name} is a human collaborator`;
  if (a.status !== "active") return `${a.name} is ${a.status}`;
  if (!a.connection || !a.model) return `${a.name} has no AI model`;
  if (a.connection.status === "reauth") return `${a.name}'s ChatGPT sign-in needs renewing`;
  return null;
}

/** One streamed call collected into text, with the same single retry the chat route uses. */
export async function complete(actor: Actor, instructions: string, turns: ChatTurn[], signal: AbortSignal, log?: StepLog): Promise<Call> {
  const problem = readiness(actor);
  if (problem) throw new CallError("unassigned", problem);
  const model = actor.model!;
  const started = Date.now();
  let text = "";
  let done: Extract<StreamEvent, { type: "done" }> | undefined;
  try {
    const provider = clientFor(actor.connection!);
    for (let attempt = 0; ; attempt++) {
      try {
        for await (const ev of provider.stream({ model, instructions, turns, signal })) {
          if (ev.type === "delta") text += ev.text;
          else done = ev;
        }
        break;
      } catch (e) {
        if (attempt === 0 && !text && e instanceof ProviderError && e.retryable && !signal.aborted) {
          await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000));
          continue;
        }
        throw e;
      }
    }
  } catch (e) {
    const err = signal.aborted
      ? new CallError("aborted", "Stopped")
      : e instanceof ProviderError
        ? new CallError(e.code, e.message)
        : e instanceof SecretError
          ? new CallError("secret", e.message)
          : new CallError("server_error", "Something went wrong while calling the AI provider.");
    await log?.({ agentId: actor.id, model, inputTokens: null, outputTokens: null, ms: Date.now() - started, errorCode: err.code });
    throw err;
  }
  const call: Call = { text, model: done?.model ?? model, inputTokens: done?.usage.inputTokens ?? null, outputTokens: done?.usage.outputTokens ?? null };
  await log?.({ agentId: actor.id, model: call.model, inputTokens: call.inputTokens, outputTokens: call.outputTokens, ms: Date.now() - started, errorCode: null });
  return call;
}

/** Asks for JSON; one repair turn includes what was wrong; then gives up with "bad_output". */
export async function completeJson<T>(actor: Actor, instructions: string, prompt: string, schema: z.ZodType<T>, signal: AbortSignal, log?: StepLog) {
  const turns: ChatTurn[] = [{ role: "user", content: prompt }];
  const calls: Call[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const call = await complete(actor, instructions, turns, signal, log);
    calls.push(call);
    let problem: string;
    try {
      const parsed = schema.safeParse(extractJson(call.text));
      if (parsed.success) return { value: parsed.data, calls };
      problem = parsed.error.issues.map((i) => `${i.path.join(".") || "reply"}: ${i.message}`).join("; ");
    } catch (e) {
      problem = (e as Error).message;
    }
    turns.push({ role: "assistant", content: call.text }, { role: "user", content: `That reply couldn't be used: ${problem.slice(0, 1000)}. Reply again with only the corrected JSON block.` });
  }
  throw new CallError("bad_output", "The reply wasn't in the expected format, even after one retry.");
}
