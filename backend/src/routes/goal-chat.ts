import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { streamReply, watchClient } from "../chat-stream.js";
import { trimTurns } from "../companion.js";
import { prisma } from "../db.js";
import type { GoalMessage } from "../generated/prisma/client.js";
import { readiness } from "../goals/llm.js";
import { goalContext, loadHead, loadRoster } from "../goals/load.js";
import { goalChatContext, goalChatInstructions } from "../goals/prompts.js";
import { HttpError, perUser, requireMember } from "../http.js";
import type { ChatTurn } from "../providers/types.js";
import { WsParams } from "./workspaces.js";

const GoalParams = WsParams.extend({ gid: z.string().min(1).max(64) });
const Send = z.object({ message: z.string().trim().min(1).max(8000) });
const OPEN = new Set(["running", "reviewing", "done", "failed", "cancelled"]);
const HISTORY = 50;

const dto = (m: GoalMessage) => ({
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

async function loadGoal(workspaceId: string, gid: string) {
  const goal = await prisma.goal.findFirst({
    where: { id: gid, workspaceId },
    include: { project: true, workspace: true, tasks: { orderBy: { position: "asc" }, include: { agent: { select: { name: true } } } }, edits: { orderBy: { createdAt: "asc" } } },
  });
  if (!goal) throw new HttpError(404, "not_found", "Goal not found");
  return goal;
}

export async function goalChatRoutes(app: FastifyInstance) {
  app.get("/api/workspaces/:id/goals/:gid/chat", async (req) => {
    const { id, gid } = GoalParams.parse(req.params);
    const { user } = await requireMember(req, id);
    await loadGoal(id, gid);
    const rows = await prisma.goalMessage.findMany({ where: { goalId: gid, userId: user.id }, orderBy: { createdAt: "desc" }, take: HISTORY });
    return { messages: rows.reverse().map(dto) };
  });

  app.delete("/api/workspaces/:id/goals/:gid/chat", async (req, reply) => {
    const { id, gid } = GoalParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    await loadGoal(id, gid);
    await prisma.goalMessage.deleteMany({ where: { goalId: gid, userId: user.id } });
    return reply.code(204).send();
  });

  app.post("/api/workspaces/:id/goals/:gid/chat", { config: { rateLimit: { max: 20, timeWindow: "1 minute", keyGenerator: perUser } } }, async (req, reply) => {
    const watch = watchClient(reply);
    const { id, gid } = GoalParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const { message } = Send.parse(req.body);
    const goal = await loadGoal(id, gid);
    if (!OPEN.has(goal.status)) throw new HttpError(409, "not_open", "Chat opens once the plan is approved.");
    const nova = await loadHead(id);
    const problem = nova ? readiness(nova) : "Your company has no head agent";
    if (problem || !nova?.connection || !nova.model) throw new HttpError(409, "unassigned", `${problem}. Choose a model on the companion's Customize form.`);
    const conn = nova.connection;
    const model = nova.model;

    const history = await prisma.goalMessage.findMany({ where: { goalId: gid, userId: user.id, status: "complete" }, orderBy: { createdAt: "desc" }, take: 20 });
    const userMsg = await prisma.goalMessage.create({ data: { goalId: gid, workspaceId: id, userId: user.id, role: "user", content: message } });
    const turns = trimTurns([...history.reverse().map((m): ChatTurn => ({ role: m.role, content: m.content })), { role: "user", content: message }], 24_000);
    const ctx = await goalContext(goal.project);
    const tasks = goal.tasks.map((t) => ({ position: t.position, title: t.title, agentName: t.agent.name, status: t.status, verdict: t.verdict, result: t.result, error: t.error }));
    const instructions = `${goalChatInstructions(goal.workspace.name, await loadRoster(id))}\n\n${goalChatContext(goal, tasks, goal.edits, ctx)}`;

    await streamReply(req, reply, watch, {
      conn,
      model,
      instructions,
      turns,
      start: { userMessageId: userMsg.id },
      save: async (r) => {
        const saved = await prisma.goalMessage.create({
          data: { goalId: gid, workspaceId: id, userId: user.id, role: "assistant", content: r.text, status: r.status, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, errorCode: r.errorCode, errorMessage: r.errorMessage },
        });
        await prisma.goalStep.create({ data: { workspaceId: id, goalId: gid, phase: "chat", agentId: nova.id, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, ms: r.ms, errorCode: r.errorCode } });
        return saved;
      },
    });
  });
}
