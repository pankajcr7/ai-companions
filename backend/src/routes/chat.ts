import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { companionInstructions, trimTurns } from "../companion.js";
import { SecretError } from "../crypto.js";
import { prisma } from "../db.js";
import type { ChatMessage } from "../generated/prisma/client.js";
import { HttpError, perUser, requireMember } from "../http.js";
import { clientFor } from "../providers/index.js";
import { ProviderError, type ChatTurn, type StreamEvent } from "../providers/types.js";
import { WsParams } from "./workspaces.js";

const AgentParams = WsParams.extend({ agentId: z.string().min(1).max(64) });
const Send = z.object({ message: z.string().trim().min(1).max(8000) });
const HISTORY = 50;
const CONTEXT_MESSAGES = 20;
const CONTEXT_CHARS = 24_000;

const dto = (m: ChatMessage) => ({
  id: m.id,
  role: m.role,
  content: m.content,
  status: m.status,
  model: m.model,
  inputTokens: m.inputTokens,
  outputTokens: m.outputTokens,
  errorCode: m.errorCode,
  errorMessage: m.errorMessage,
  createdAt: m.createdAt,
});

async function loadAgent(workspaceId: string, agentId: string) {
  const agent = await prisma.agent.findFirst({ where: { id: agentId, workspaceId }, include: { connection: true, department: true, workspace: { select: { name: true } } } });
  if (!agent) throw new HttpError(404, "not_found", "Companion not found");
  return agent;
}

export async function chatRoutes(app: FastifyInstance) {
  app.get("/api/workspaces/:id/agents/:agentId/chat", async (req) => {
    const { id, agentId } = AgentParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    await loadAgent(id, agentId);
    const rows = await prisma.chatMessage.findMany({ where: { agentId, userId: user.id }, orderBy: { createdAt: "desc" }, take: HISTORY });
    return { messages: rows.reverse().map(dto) };
  });

  app.delete("/api/workspaces/:id/agents/:agentId/chat", async (req, reply) => {
    const { id, agentId } = AgentParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    await loadAgent(id, agentId);
    await prisma.chatMessage.deleteMany({ where: { agentId, userId: user.id } });
    return reply.code(204).send();
  });

  app.post(
    "/api/workspaces/:id/agents/:agentId/chat",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute", keyGenerator: perUser } } },
    async (req, reply) => {
      const { id, agentId } = AgentParams.parse(req.params);
      const { user } = await requireMember(req, id, "member");
      const { message } = Send.parse(req.body);
      const agent = await loadAgent(id, agentId);
      if (agent.status === "archived") throw new HttpError(409, "inactive", `Restore ${agent.name} before chatting`);
      if (agent.status === "paused") throw new HttpError(409, "inactive", `Resume ${agent.name} before chatting`);
      const conn = agent.connection;
      if (!conn || !agent.model) throw new HttpError(409, "unassigned", `Choose an AI model for ${agent.name} first`);
      if (conn.status === "reauth") throw new HttpError(409, "reauth", "Sign in to ChatGPT again on the AI providers page");

      const history = await prisma.chatMessage.findMany({
        where: { agentId, userId: user.id, status: "complete" },
        orderBy: { createdAt: "desc" },
        take: CONTEXT_MESSAGES,
      });
      const userMsg = await prisma.chatMessage.create({ data: { workspaceId: id, agentId, userId: user.id, role: "user", content: message } });
      const turns = trimTurns([...history.reverse().map((m): ChatTurn => ({ role: m.role, content: m.content })), { role: "user", content: message }], CONTEXT_CHARS);
      const instructions = companionInstructions(agent, agent.workspace.name, agent.department?.name ?? null);

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" });
      const send = (event: string, data: unknown) => raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      send("start", { userMessageId: userMsg.id });

      const ac = new AbortController();
      let clientGone = false;
      raw.on("close", () => {
        if (!raw.writableEnded) {
          clientGone = true;
          ac.abort();
        }
      });
      const signal = AbortSignal.any([ac.signal, AbortSignal.timeout(300_000)]);

      let text = "";
      let done: Extract<StreamEvent, { type: "done" }> | undefined;
      let failure: { code: string; message: string } | undefined;
      try {
        const provider = clientFor(conn);
        for (let attempt = 0; ; attempt++) {
          try {
            for await (const ev of provider.stream({ model: agent.model, instructions, turns, signal })) {
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
        if (clientGone) failure = undefined;
        else if (signal.aborted) failure = { code: "timeout", message: "The reply took too long and was stopped." };
        else if (e instanceof ProviderError || e instanceof SecretError) failure = { code: e instanceof ProviderError ? e.code : "secret", message: e.message };
        else {
          req.log.error(e);
          failure = { code: "server_error", message: "Something went wrong while getting the reply." };
        }
      }

      const status = clientGone ? "stopped" : failure ? "error" : "complete";
      const saved = await prisma.chatMessage.create({
        data: {
          workspaceId: id,
          agentId,
          userId: user.id,
          role: "assistant",
          content: text,
          status,
          connectionId: conn.id,
          kind: conn.kind,
          model: done?.model ?? agent.model,
          inputTokens: done?.usage.inputTokens ?? null,
          outputTokens: done?.usage.outputTokens ?? null,
          errorCode: failure?.code ?? null,
          errorMessage: failure?.message ?? null,
        },
      });
      if (conn.kind === "chatgpt" && failure && (failure.code === "auth" || failure.code === "reauth")) {
        await prisma.providerConnection.update({ where: { id: conn.id }, data: { status: "reauth", lastError: "Sign in to ChatGPT again" } });
        failure = { code: "reauth", message: "Sign in to ChatGPT again to keep using it." };
      }
      if (clientGone) return;
      if (failure) send("error", { messageId: saved.id, ...failure });
      else send("done", { messageId: saved.id, model: saved.model, inputTokens: saved.inputTokens, outputTokens: saved.outputTokens });
      raw.end();
    },
  );
}
