import type { FastifyReply, FastifyRequest } from "fastify";
import { SecretError } from "./crypto.js";
import { prisma } from "./db.js";
import type { ProviderConnection } from "./generated/prisma/client.js";
import { CallError, type Actor } from "./goals/llm.js";
import { runLoop, type Tool, type ToolUse } from "./harness/loop.js";
import type { ChatTurn } from "./providers/types.js";

export type ClientWatch = { signal: AbortSignal; gone: () => boolean };

/** Call first in the handler: with a slow database the client can leave before streaming starts. */
export function watchClient(reply: FastifyReply): ClientWatch {
  const ac = new AbortController();
  let gone = false;
  reply.raw.on("close", () => {
    if (!reply.raw.writableEnded) {
      gone = true;
      ac.abort();
    }
  });
  return { signal: ac.signal, gone: () => gone };
}

export type SavedReply = {
  text: string;
  status: "complete" | "error" | "stopped";
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  ms: number;
  toolUses: ToolUse[];
};

/** Streams a model reply as SSE (start, delta, tool, error|done), letting it use tools, and always ends the response, even if saving fails. */
export async function streamReply(
  req: FastifyRequest,
  reply: FastifyReply,
  watch: ClientWatch,
  opts: { actor: Actor & { model: string; connection: ProviderConnection }; instructions: string; turns: ChatTurn[]; tools: Tool[]; limit: number; start: Record<string, unknown>; save: (r: SavedReply) => Promise<{ id: string }> },
) {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" });
  const send = (event: string, data: unknown) => raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send("start", opts.start);

  const signal = AbortSignal.any([watch.signal, AbortSignal.timeout(300_000)]);
  const started = Date.now();
  let text = "";
  // What the owner saw stream in the current round; kept if the reply stops or fails midway.
  let streamed = "";
  let toolUses: ToolUse[] = [];
  let model = opts.actor.model;
  let inTokens = 0;
  let outTokens = 0;
  let counted = false;
  let failure: { code: string; message: string } | undefined;
  try {
    const loop = await runLoop({
      actor: opts.actor,
      instructions: opts.instructions,
      turns: opts.turns,
      tools: opts.tools,
      limit: opts.limit,
      signal,
      onEvent: (e) => {
        if (e.type === "delta") {
          streamed += e.text;
          send("delta", { text: e.text });
        } else {
          streamed = "";
          send("tool", { name: e.name, label: e.label });
        }
      },
    });
    text = loop.text;
    toolUses = loop.toolUses;
    for (const c of loop.calls) {
      model = c.model;
      inTokens += c.inputTokens ?? 0;
      outTokens += c.outputTokens ?? 0;
      counted ||= c.inputTokens != null || c.outputTokens != null;
    }
  } catch (e) {
    text = streamed;
    if (watch.gone()) failure = undefined;
    else if (e instanceof CallError && e.code === "aborted") failure = { code: "timeout", message: "The reply took too long and was stopped." };
    else if (e instanceof CallError) failure = { code: e.code, message: e.message };
    else if (e instanceof SecretError) failure = { code: "secret", message: e.message };
    else {
      req.log.error(e);
      failure = { code: "server_error", message: "Something went wrong while getting the reply." };
    }
  }

  const status = watch.gone() ? "stopped" : failure ? "error" : "complete";
  const inputTokens = counted ? inTokens : null;
  const outputTokens = counted ? outTokens : null;
  // The response is already hijacked: whatever happens below, the stream must end.
  try {
    const saved = await opts.save({ text, status, model, inputTokens, outputTokens, errorCode: failure?.code ?? null, errorMessage: failure?.message ?? null, ms: Date.now() - started, toolUses });
    if (opts.actor.connection.kind === "chatgpt" && failure && (failure.code === "auth" || failure.code === "reauth")) {
      await prisma.providerConnection.update({ where: { id: opts.actor.connection.id }, data: { status: "reauth", lastError: "Sign in to ChatGPT again" } });
      failure = { code: "reauth", message: "Sign in to ChatGPT again to keep using it." };
    }
    if (watch.gone()) return;
    if (failure) send("error", { messageId: saved.id, ...failure });
    else send("done", { messageId: saved.id, model, inputTokens, outputTokens });
  } catch (e) {
    req.log.error(e);
    if (!watch.gone()) send("error", { messageId: null, code: "server_error", message: "The reply couldn't be saved. Try again." });
  } finally {
    if (!raw.writableEnded) raw.end();
  }
}
