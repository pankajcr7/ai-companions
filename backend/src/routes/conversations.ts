import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { streamReply, watchClient } from "../chat-stream.js";
import { trimTurns } from "../companion.js";
import { prisma } from "../db.js";
import type { ChatEdit, ChatMessage } from "../generated/prisma/client.js";
import { loadProject } from "../files/service.js";
import { projectTools, webTools } from "../harness/tools.js";
import { loadSearchKey } from "../harness/web.js";
import { chatEditDTO, chatWriter, saveChatEdits } from "./chat-edits.js";
import { createGoal } from "../goals/create.js";
import { readiness } from "../goals/llm.js";
import { loadHead, loadRoster } from "../goals/load.js";
import { conversationGoalsContext, headInstructions } from "../goals/prompts.js";
import { parseSuggestion } from "../goals/suggest.js";
import { HttpError, perUser, requireMember } from "../http.js";
import type { ChatTurn } from "../providers/types.js";
import { WsParams } from "./workspaces.js";

const ConvParams = WsParams.extend({ cid: z.string().min(1).max(64) });
const Project = z.discriminatedUnion("kind", [z.object({ kind: z.literal("none") }), z.object({ kind: z.literal("existing"), id: z.string().min(1).max(64) }), z.object({ kind: z.literal("new") })]);
const Send = z.object({ message: z.string().trim().min(1).max(8000), project: Project.default({ kind: "none" }) });

const dto = (m: ChatMessage & { edits?: ChatEdit[] }) => ({
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
  toolUses: m.toolUses,
  edits: (m.edits ?? []).map(chatEditDTO),
  goalId: m.goalId,
  planBlocked: m.planBlocked,
});

const titleFrom = (text: string) => (text.length > 60 ? `${text.slice(0, 57)}...` : text);

async function loadConversation(workspaceId: string, userId: string, cid: string) {
  const c = await prisma.conversation.findFirst({ where: { id: cid, workspaceId, userId } });
  if (!c) throw new HttpError(404, "not_found", "Conversation not found");
  return c;
}

export async function conversationRoutes(app: FastifyInstance) {
  app.get("/api/workspaces/:id/conversations", async (req) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id);
    const rows = await prisma.conversation.findMany({ where: { workspaceId: id, userId: user.id }, orderBy: { updatedAt: "desc" }, take: 100 });
    return { conversations: rows.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt })) };
  });

  app.post("/api/workspaces/:id/conversations", async (req, reply) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const c = await prisma.conversation.create({ data: { workspaceId: id, userId: user.id } });
    return reply.code(201).send({ id: c.id });
  });

  app.patch("/api/workspaces/:id/conversations/:cid", async (req) => {
    const { id, cid } = ConvParams.parse(req.params);
    const { user } = await requireMember(req, id);
    await loadConversation(id, user.id, cid);
    const { title } = z.object({ title: z.string().trim().min(1).max(60) }).parse(req.body);
    await prisma.conversation.update({ where: { id: cid }, data: { title } });
    return { ok: true };
  });

  app.delete("/api/workspaces/:id/conversations/:cid", async (req, reply) => {
    const { id, cid } = ConvParams.parse(req.params);
    const { user } = await requireMember(req, id);
    await loadConversation(id, user.id, cid);
    await prisma.conversation.delete({ where: { id: cid } });
    return reply.code(204).send();
  });

  app.get("/api/workspaces/:id/conversations/:cid", async (req) => {
    const { id, cid } = ConvParams.parse(req.params);
    const { user } = await requireMember(req, id);
    const c = await loadConversation(id, user.id, cid);
    const rows = await prisma.chatMessage.findMany({ where: { conversationId: cid }, orderBy: { createdAt: "desc" }, take: 200, include: { edits: { orderBy: { createdAt: "asc" } } } });
    return { conversation: { id: c.id, title: c.title }, messages: rows.reverse().map(dto) };
  });

  // A work request that couldn't be planned when it was asked (the team was busy) is planned from its message later.
  app.post("/api/workspaces/:id/conversations/:cid/messages/:mid/plan", async (req) => {
    const { id, cid, mid } = ConvParams.extend({ mid: z.string().min(1).max(64) }).parse(req.params);
    const { user } = await requireMember(req, id, "member");
    await loadConversation(id, user.id, cid);
    const msg = await prisma.chatMessage.findFirst({ where: { id: mid, conversationId: cid, role: "assistant" } });
    const suggestion = msg ? parseSuggestion(msg.content) : null;
    if (!msg || !suggestion?.goal) throw new HttpError(404, "not_found", "Message not found");
    if (msg.goalId) throw new HttpError(409, "planned", "This request already has a plan.");
    // The owner may have edited the request on the card before planning it.
    const { text } = z.object({ text: z.string().trim().min(1).max(4000).optional() }).parse(req.body ?? {});
    const latest = await prisma.chatMessage.findFirst({ where: { conversationId: cid, goalId: { not: null } }, orderBy: { createdAt: "desc" }, select: { goalId: true } });
    const goal = await createGoal({ workspaceId: id, userId: user.id, text: text ?? suggestion.goal, newProject: suggestion.newProject, parentGoalId: latest?.goalId ?? null, projectId: latest ? undefined : null, log: (e) => req.log.error(e) });
    // Conditional, so two clicks can't link two goals to one message.
    const linked = await prisma.chatMessage.updateMany({ where: { id: mid, goalId: null }, data: { goalId: goal.id, planBlocked: null } });
    if (!linked.count) throw new HttpError(409, "planned", "This request already has a plan.");
    return { goalId: goal.id };
  });

  app.post("/api/workspaces/:id/conversations/:cid/messages", { config: { rateLimit: { max: 20, timeWindow: "1 minute", keyGenerator: perUser } } }, async (req, reply) => {
    const watch = watchClient(reply);
    const { id, cid } = ConvParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const { message, project } = Send.parse(req.body);
    const conv = await loadConversation(id, user.id, cid);
    const nova = await loadHead(id);
    const problem = nova ? readiness(nova) : "Your company has no head agent";
    if (problem || !nova?.connection || !nova.model) throw new HttpError(409, "unassigned", `${problem}. Choose a model on the companion's Customize form.`);
    const conn = nova.connection;
    const model = nova.model;
    // Companions can look through the project chosen in the "Working on" chip; their file changes become suggestions.
    const projectRow = project.kind === "existing" ? await loadProject(id, project.id) : null;
    const writer = chatWriter();
    const tools = [...(projectRow ? projectTools(projectRow, { write: writer.write, read: new Map() }) : []), ...webTools(await loadSearchKey(id))];

    const history = await prisma.chatMessage.findMany({ where: { conversationId: cid, status: "complete" }, orderBy: { createdAt: "desc" }, take: 20 });
    const userMsg = await prisma.chatMessage.create({ data: { workspaceId: id, agentId: nova.id, userId: user.id, conversationId: cid, role: "user", content: message } });
    await prisma.conversation.update({ where: { id: cid }, data: conv.title === "New chat" ? { title: titleFrom(message) } : { updatedAt: new Date() } });
    const turns = trimTurns([...history.reverse().map((m): ChatTurn => ({ role: m.role, content: m.content })), { role: "user", content: message }], 24_000);

    const linked = await prisma.chatMessage.findMany({ where: { conversationId: cid, goalId: { not: null } }, orderBy: { createdAt: "desc" }, take: 3, select: { goalId: true } });
    const goals = await prisma.goal.findMany({ where: { id: { in: linked.map((l) => l.goalId!) }, workspaceId: id }, include: { tasks: { orderBy: { position: "asc" }, include: { agent: { select: { name: true } } } } }, orderBy: { createdAt: "asc" } });
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id } });
    const instructions = [
      headInstructions(nova, workspace.name, null, await loadRoster(id)),
      conversationGoalsContext(goals.map((g) => ({ text: g.text, status: g.status, summary: g.summary, tasks: g.tasks.map((t) => ({ title: t.title, agentName: t.agent.name, status: t.status, result: t.result })) }))),
    ]
      .filter(Boolean)
      .join("\n\n");
    const latestGoalId = goals.at(-1)?.id ?? null;

    await streamReply(req, reply, watch, {
      actor: { ...nova, model, connection: conn },
      tools,
      limit: 6,
      instructions,
      turns,
      start: { userMessageId: userMsg.id },
      save: async (r) => {
        const saved = await prisma.chatMessage.create({
          data: { workspaceId: id, agentId: nova.id, userId: user.id, conversationId: cid, role: "assistant", content: r.text, status: r.status, connectionId: conn.id, kind: conn.kind, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, errorCode: r.errorCode, errorMessage: r.errorMessage, toolUses: r.toolUses },
        });
        await saveChatEdits(id, saved.id, projectRow?.id ?? null, writer.edits);
        const suggestion = r.status === "complete" ? parseSuggestion(r.text) : null;
        if (!suggestion?.goal) return saved;
        // Work requests become a plan right away; nothing runs until the owner presses Start.
        try {
          const goal = await createGoal({
            workspaceId: id,
            userId: user.id,
            text: suggestion.goal,
            newProject: suggestion.newProject || project.kind === "new",
            projectId: project.kind === "existing" ? project.id : latestGoalId ? undefined : null,
            parentGoalId: latestGoalId,
            log: (e) => req.log.error(e),
          });
          await prisma.chatMessage.update({ where: { id: saved.id }, data: { goalId: goal.id } });
        } catch (e) {
          if (!(e instanceof HttpError)) throw e;
          await prisma.chatMessage.update({ where: { id: saved.id }, data: { planBlocked: e.code === "busy" ? "busy" : e.message } });
        }
        return saved;
      },
    });
  });
}
