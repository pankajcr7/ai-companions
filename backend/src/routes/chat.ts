import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { streamReply, watchClient } from "../chat-stream.js";
import { companionInstructions, trimTurns } from "../companion.js";
import { loadRoster } from "../goals/load.js";
import { headInstructions } from "../goals/prompts.js";
import { prisma } from "../db.js";
import type { ChatMessage } from "../generated/prisma/client.js";
import { HttpError, perUser, requireMember } from "../http.js";
import type { ChatTurn } from "../providers/types.js";
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
    const rows = await prisma.chatMessage.findMany({ where: { agentId, userId: user.id, conversationId: null }, orderBy: { createdAt: "desc" }, take: HISTORY });
    return { messages: rows.reverse().map(dto) };
  });

  app.delete("/api/workspaces/:id/agents/:agentId/chat", async (req, reply) => {
    const { id, agentId } = AgentParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    await loadAgent(id, agentId);
    await prisma.chatMessage.deleteMany({ where: { agentId, userId: user.id, conversationId: null } });
    return reply.code(204).send();
  });

  app.post(
    "/api/workspaces/:id/agents/:agentId/chat",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute", keyGenerator: perUser } } },
    async (req, reply) => {
      const watch = watchClient(reply);
      const { id, agentId } = AgentParams.parse(req.params);
      const { user } = await requireMember(req, id, "member");
      const { message } = Send.parse(req.body);
      const agent = await loadAgent(id, agentId);
      if (agent.status === "archived") throw new HttpError(409, "inactive", `Restore ${agent.name} before chatting`);
      if (agent.status === "paused") throw new HttpError(409, "inactive", `Resume ${agent.name} before chatting`);
      const conn = agent.connection;
      if (!conn || !agent.model) throw new HttpError(409, "unassigned", `Choose an AI model for ${agent.name} first`);
      if (conn.status === "reauth") throw new HttpError(409, "reauth", "Sign in to ChatGPT again in Settings › AI services");

      const history = await prisma.chatMessage.findMany({ where: { agentId, userId: user.id, status: "complete", conversationId: null }, orderBy: { createdAt: "desc" }, take: CONTEXT_MESSAGES });
      const userMsg = await prisma.chatMessage.create({ data: { workspaceId: id, agentId, userId: user.id, role: "user", content: message } });
      const turns = trimTurns([...history.reverse().map((m): ChatTurn => ({ role: m.role, content: m.content })), { role: "user", content: message }], CONTEXT_CHARS);
      // Nova leads the team, so its chat knows the roster and can hand work to it; other companions just chat.
      const instructions = agent.isHead
        ? headInstructions(agent, agent.workspace.name, agent.department?.name ?? null, await loadRoster(id))
        : companionInstructions(agent, agent.workspace.name, agent.department?.name ?? null);
      await streamReply(req, reply, watch, {
        conn,
        model: agent.model,
        instructions,
        turns,
        start: { userMessageId: userMsg.id },
        save: (r) =>
          prisma.chatMessage.create({
            data: { workspaceId: id, agentId, userId: user.id, role: "assistant", content: r.text, status: r.status, connectionId: conn.id, kind: conn.kind, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, errorCode: r.errorCode, errorMessage: r.errorMessage },
          }),
      });
    },
  );
}
