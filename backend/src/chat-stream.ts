import type { FastifyReply, FastifyRequest } from "fastify";
import { SecretError } from "./crypto.js";
import { prisma } from "./db.js";
import type { ProviderConnection } from "./generated/prisma/client.js";
import { clientFor } from "./providers/index.js";
import { ProviderError, type ChatTurn, type StreamEvent } from "./providers/types.js";

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
};

/** Streams a model reply as SSE (start, delta, error|done) and always ends the response, even if saving fails. */
export async function streamReply(
  req: FastifyRequest,
  reply: FastifyReply,
  watch: ClientWatch,
  opts: { conn: ProviderConnection; model: string; instructions: string; turns: ChatTurn[]; start: Record<string, unknown>; save: (r: SavedReply) => Promise<{ id: string }> },
) {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" });
  const send = (event: string, data: unknown) => raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send("start", opts.start);

  const signal = AbortSignal.any([watch.signal, AbortSignal.timeout(300_000)]);
  const started = Date.now();
  let text = "";
  let done: Extract<StreamEvent, { type: "done" }> | undefined;
  let failure: { code: string; message: string } | undefined;
  try {
    const provider = clientFor(opts.conn);
    for (let attempt = 0; ; attempt++) {
      try {
        for await (const ev of provider.stream({ model: opts.model, instructions: opts.instructions, turns: opts.turns, signal })) {
          if (ev.type === "delta") {
            text += ev.text;
            send("delta", { text: ev.text });
          } else done = ev;
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
    if (watch.gone()) failure = undefined;
    else if (signal.aborted) failure = { code: "timeout", message: "The reply took too long and was stopped." };
    else if (e instanceof ProviderError || e instanceof SecretError) failure = { code: e instanceof ProviderError ? e.code : "secret", message: e.message };
    else {
      req.log.error(e);
      failure = { code: "server_error", message: "Something went wrong while getting the reply." };
    }
  }

  const status = watch.gone() ? "stopped" : failure ? "error" : "complete";
  const model = done?.model ?? opts.model;
  const inputTokens = done?.usage.inputTokens ?? null;
  const outputTokens = done?.usage.outputTokens ?? null;
  // The response is already hijacked: whatever happens below, the stream must end.
  try {
    const saved = await opts.save({ text, status, model, inputTokens, outputTokens, errorCode: failure?.code ?? null, errorMessage: failure?.message ?? null, ms: Date.now() - started });
    if (opts.conn.kind === "chatgpt" && failure && (failure.code === "auth" || failure.code === "reauth")) {
      await prisma.providerConnection.update({ where: { id: opts.conn.id }, data: { status: "reauth", lastError: "Sign in to ChatGPT again" } });
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
