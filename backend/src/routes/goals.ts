import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import type { Prisma } from "../generated/prisma/client.js";
import { loadProject } from "../files/service.js";
import { readiness } from "../goals/llm.js";
import { loadHead } from "../goals/load.js";
import { Plan, planProblems } from "../goals/plan.js";
import { planGoal } from "../goals/planner.js";
import { abortGoal, kickGoal } from "../goals/runner.js";
import { audit, HttpError, perUser, requireMember } from "../http.js";
import { WsParams } from "./workspaces.js";

const GoalParams = WsParams.extend({ gid: z.string().min(1).max(64) });
const TaskParams = GoalParams.extend({ tid: z.string().min(1).max(64) });
const ACTIVE = ["planning", "running", "reviewing"] as const;
export const RATING_REASONS = ["wrong facts", "off-brand", "too generic", "ignored files", "too long"] as const;

const withTasks = { tasks: { orderBy: { position: "asc" }, include: { agent: { select: { name: true } } } }, edits: { orderBy: { createdAt: "asc" } } } satisfies Prisma.GoalInclude;
type FullGoal = Prisma.GoalGetPayload<{ include: typeof withTasks }>;

async function loadGoal(workspaceId: string, gid: string) {
  const goal = await prisma.goal.findFirst({ where: { id: gid, workspaceId }, include: withTasks });
  if (!goal) throw new HttpError(404, "not_found", "Goal not found");
  return goal;
}

async function goalDTO(goal: FullGoal) {
  const head = goal.status === "planning" || goal.status === "reviewing" ? await loadHead(goal.workspaceId) : null;
  const working = [...new Set([...goal.tasks.filter((t) => t.status === "running").map((t) => t.agentId), ...(head ? [head.id] : [])])];
  return {
    id: goal.id,
    text: goal.text,
    status: goal.status,
    projectId: goal.projectId,
    summary: goal.summary,
    error: goal.error,
    inputTokens: goal.inputTokens,
    outputTokens: goal.outputTokens,
    createdAt: goal.createdAt,
    working,
    tasks: goal.tasks.map((t) => ({
      id: t.id,
      position: t.position,
      agentId: t.agentId,
      agentName: t.agent.name,
      title: t.title,
      instructions: t.instructions,
      deliverable: t.deliverable,
      criteria: t.criteria,
      dependsOn: t.dependsOn,
      status: t.status,
      result: t.result,
      filesRead: t.filesRead,
      error: t.error,
      errorCode: t.errorCode,
      verdict: t.verdict,
      verdictNote: t.verdictNote,
      rating: t.rating,
      ratingReason: t.ratingReason,
      inputTokens: t.inputTokens,
      outputTokens: t.outputTokens,
    })),
    edits: goal.edits.map((e) => ({ id: e.id, taskId: e.taskId, path: e.path, baseRevision: e.baseRevision, note: e.note, status: e.status, reason: e.reason })),
  };
}

// ponytail: check-then-create; two simultaneous creates can both pass. A partial unique index fixes it if it matters.
async function assertNoActiveGoal(workspaceId: string, except?: string) {
  const busy = await prisma.goal.findFirst({ where: { workspaceId, status: { in: [...ACTIVE] }, ...(except ? { id: { not: except } } : {}) } });
  if (busy) throw new HttpError(409, "busy", "Another goal is still in progress. Wait for it to finish or cancel it.");
}

async function rosterIds(workspaceId: string) {
  const roster = await prisma.agent.findMany({ where: { workspaceId, kind: "ai", status: "active" }, select: { id: true } });
  return new Set(roster.map((r) => r.id));
}

export async function goalRoutes(app: FastifyInstance) {
  app.post("/api/workspaces/:id/goals", { config: { rateLimit: { max: 10, timeWindow: "1 minute", keyGenerator: perUser } } }, async (req, reply) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const body = z.object({ text: z.string().trim().min(1).max(4000), projectId: z.string().min(1).max(64).nullish() }).parse(req.body);
    if (body.projectId) await loadProject(id, body.projectId);
    const nova = await loadHead(id);
    const problem = nova ? readiness(nova) : "Your company has no head agent";
    if (problem) throw new HttpError(409, "unassigned", `${problem}. Choose a model on the companion's Customize form.`);
    await assertNoActiveGoal(id);
    const goal = await prisma.goal.create({ data: { workspaceId: id, projectId: body.projectId ?? null, text: body.text, createdById: user.id } });
    await audit(prisma, id, user.id, "goal.create", "goal", goal.id);
    void planGoal(goal.id);
    return reply.code(201).send({ id: goal.id });
  });

  app.get("/api/workspaces/:id/goals", async (req) => {
    const { id } = WsParams.parse(req.params);
    await requireMember(req, id);
    const goals = await prisma.goal.findMany({ where: { workspaceId: id }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, text: true, status: true, projectId: true, createdAt: true } });
    return { goals };
  });

  app.get("/api/workspaces/:id/goals/:gid", async (req) => {
    const { id, gid } = GoalParams.parse(req.params);
    await requireMember(req, id);
    return { goal: await goalDTO(await loadGoal(id, gid)) };
  });

  app.put("/api/workspaces/:id/goals/:gid/plan", async (req) => {
    const { id, gid } = GoalParams.parse(req.params);
    await requireMember(req, id, "member");
    await loadGoal(id, gid);
    const plan = Plan.parse(req.body);
    const problems = planProblems(plan, await rosterIds(id));
    if (problems.length) throw new HttpError(400, "invalid", problems.join("; "));
    const saved = await prisma.$transaction(async (tx) => {
      const g = await tx.goal.findFirst({ where: { id: gid, status: "awaiting_approval" } });
      if (!g) return false;
      await tx.goalTask.deleteMany({ where: { goalId: gid } });
      await tx.goalTask.createMany({ data: plan.tasks.map((t, position) => ({ goalId: gid, position, ...t })) });
      return true;
    });
    if (!saved) throw new HttpError(409, "conflict", "This plan can't be changed any more: the goal has already started or ended.");
    return { ok: true };
  });

  app.post("/api/workspaces/:id/goals/:gid/start", async (req) => {
    const { id, gid } = GoalParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const goal = await loadGoal(id, gid);
    if (goal.status !== "awaiting_approval") throw new HttpError(409, "conflict", "This goal isn't waiting for approval.");
    const agents = await prisma.agent.findMany({ where: { id: { in: goal.tasks.map((t) => t.agentId) } }, include: { connection: true } });
    const problems = [...new Set(agents.map(readiness).filter((p): p is string => !!p))];
    if (problems.length) throw new HttpError(400, "unassigned", `Fix these before starting: ${problems.join("; ")}.`);
    await assertNoActiveGoal(id, gid);
    const r = await prisma.goal.updateMany({ where: { id: gid, status: "awaiting_approval" }, data: { status: "running" } });
    if (!r.count) throw new HttpError(409, "conflict", "This goal has already started.");
    await audit(prisma, id, user.id, "goal.start", "goal", gid);
    kickGoal(gid);
    return { ok: true };
  });

  app.post("/api/workspaces/:id/goals/:gid/cancel", async (req) => {
    const { id, gid } = GoalParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    await loadGoal(id, gid);
    const r = await prisma.goal.updateMany({ where: { id: gid, status: { in: ["planning", "awaiting_approval", "running", "reviewing"] } }, data: { status: "cancelled" } });
    if (!r.count) throw new HttpError(409, "conflict", "This goal has already ended.");
    abortGoal(gid);
    await prisma.goalTask.updateMany({ where: { goalId: gid, status: { in: ["pending", "running"] } }, data: { status: "skipped", error: "Cancelled" } });
    await audit(prisma, id, user.id, "goal.cancel", "goal", gid);
    return { ok: true };
  });

  app.post("/api/workspaces/:id/goals/:gid/replan", async (req) => {
    const { id, gid } = GoalParams.parse(req.params);
    await requireMember(req, id, "member");
    const goal = await loadGoal(id, gid);
    if (goal.status !== "failed" || goal.tasks.length) throw new HttpError(409, "conflict", "Only a goal whose planning failed can be planned again.");
    await assertNoActiveGoal(id, gid);
    await prisma.goal.update({ where: { id: gid }, data: { status: "planning", error: null } });
    void planGoal(gid);
    return { ok: true };
  });

  app.post("/api/workspaces/:id/goals/:gid/tasks/:tid/retry", async (req) => {
    const { id, gid, tid } = TaskParams.parse(req.params);
    await requireMember(req, id, "member");
    const goal = await loadGoal(id, gid);
    const task = goal.tasks.find((t) => t.id === tid);
    if (!task) throw new HttpError(404, "not_found", "Task not found");
    if (task.status !== "failed" && task.status !== "interrupted") throw new HttpError(409, "conflict", "Only a failed or interrupted task can be retried.");
    if (goal.status === "cancelled" || goal.status === "awaiting_approval" || goal.status === "planning") throw new HttpError(409, "conflict", "This goal can't be resumed.");
    if (goal.status !== "running") await assertNoActiveGoal(id, gid);
    // Re-open the task and every skipped task that waits on it, directly or indirectly.
    const reopen = new Set([task.position]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of goal.tasks) if (!reopen.has(t.position) && t.status === "skipped" && t.dependsOn.some((d) => reopen.has(d))) (reopen.add(t.position), (grew = true));
    }
    await prisma.$transaction([
      prisma.goalTask.updateMany({ where: { goalId: gid, position: { in: [...reopen] } }, data: { status: "pending", result: null, error: null, errorCode: null, verdict: null, verdictNote: null, startedAt: null, finishedAt: null } }),
      prisma.goal.update({ where: { id: gid }, data: { status: "running", summary: null, error: null } }),
    ]);
    kickGoal(gid);
    return { ok: true };
  });

  app.post("/api/workspaces/:id/goals/:gid/tasks/:tid/rating", async (req) => {
    const { id, gid, tid } = TaskParams.parse(req.params);
    await requireMember(req, id, "member");
    const goal = await loadGoal(id, gid);
    const task = goal.tasks.find((t) => t.id === tid);
    if (!task) throw new HttpError(404, "not_found", "Task not found");
    if (task.status !== "done") throw new HttpError(409, "conflict", "Only finished tasks can be rated.");
    const { rating, reason } = z.object({ rating: z.union([z.literal(1), z.literal(-1)]), reason: z.enum(RATING_REASONS).optional() }).parse(req.body);
    await prisma.goalTask.update({ where: { id: tid }, data: { rating, ratingReason: rating === -1 ? (reason ?? null) : null } });
    return { ok: true };
  });
}
