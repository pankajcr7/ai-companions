import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import type { Prisma } from "../generated/prisma/client.js";
import { loadProject, saveText, uniqueProjectName } from "../files/service.js";
import { getBlob } from "../files/store.js";
import { readiness } from "../goals/llm.js";
import { loadHead } from "../goals/load.js";
import { Plan, planProblems } from "../goals/plan.js";
import { ACTIVE, createGoal } from "../goals/create.js";
import { BRIEF_PATH } from "../goals/quality.js";
import { copyGoalAttachments } from "../attachments/service.js";
import { planGoal } from "../goals/planner.js";
import { abortGoal, kickGoal } from "../goals/runner.js";
import { audit, HttpError, perUser, requireMember } from "../http.js";
import { WsParams } from "./workspaces.js";

const GoalParams = WsParams.extend({ gid: z.string().min(1).max(64) });
const TaskParams = GoalParams.extend({ tid: z.string().min(1).max(64) });
export const RATING_REASONS = ["wrong facts", "off-brand", "too generic", "ignored files", "too long"] as const;

const withTasks = { parent: { select: { id: true, text: true } }, tasks: { orderBy: { position: "asc" }, include: { agent: { select: { name: true } } } }, edits: { orderBy: { createdAt: "asc" } } } satisfies Prisma.GoalInclude;
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
    newProject: goal.newProject,
    projectName: goal.projectName,
    brief: goal.brief,
    parent: goal.parent,
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
      toolUses: t.toolUses,
      review: t.review ?? null,
      error: t.error,
      errorCode: t.errorCode,
      verdict: t.verdict,
      verdictNote: t.verdictNote,
      rating: t.rating,
      ratingReason: t.ratingReason,
      startedAt: t.startedAt,
      finishedAt: t.finishedAt,
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

/** The goal's design brief becomes the project's shared brief: saved when there is none yet, otherwise suggested. */
async function saveBrief(workspaceId: string, goalId: string, userId: string, projectId: string, brief: string) {
  const project = await loadProject(workspaceId, projectId);
  const existing = await prisma.projectEntry.findFirst({ where: { projectId, pathLower: BRIEF_PATH } });
  if (!existing) {
    await saveText(project, userId, BRIEF_PATH, brief, 0).catch((e) => console.error("brief", e));
    return;
  }
  const first = await prisma.goalTask.findFirst({ where: { goalId }, orderBy: { position: "asc" } });
  if (first) await prisma.proposedEdit.create({ data: { taskId: first.id, goalId, path: existing.path, baseRevision: existing.revision, content: brief, note: "Nova's design brief for this goal", status: "pending" } });
}

export async function goalRoutes(app: FastifyInstance) {
  app.post("/api/workspaces/:id/goals", { config: { rateLimit: { max: 10, timeWindow: "1 minute", keyGenerator: perUser } } }, async (req, reply) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const body = z.object({ text: z.string().trim().min(1).max(4000), projectId: z.string().min(1).max(64).nullish(), parentGoalId: z.string().min(1).max(64).nullish(), newProject: z.boolean().optional() }).parse(req.body);
    const { id: goalId } = await createGoal({ workspaceId: id, userId: user.id, text: body.text, projectId: body.projectId, parentGoalId: body.parentGoalId, newProject: body.newProject, log: (e) => req.log.error(e) });
    return reply.code(201).send({ id: goalId });
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
    const goal = await loadGoal(id, gid);
    const plan = Plan.parse(req.body);
    if (goal.newProject && !plan.projectName) throw new HttpError(400, "invalid", "Give the new project a name.");
    const problems = planProblems(plan, await rosterIds(id));
    if (problems.length) throw new HttpError(400, "invalid", problems.join("; "));
    const saved = await prisma.$transaction(async (tx) => {
      // A conditional write locks the goal row, so a Start in progress finishes first and this then finds it running.
      const locked = await tx.goal.updateMany({ where: { id: gid, status: "awaiting_approval" }, data: { updatedAt: new Date() } });
      if (!locked.count) return false;
      await tx.goal.update({ where: { id: gid }, data: { projectName: goal.newProject ? (plan.projectName ?? null) : null, brief: plan.brief === undefined ? undefined : plan.brief || null } });
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
    const started = await prisma.$transaction(async (tx) => {
      const claim = await tx.goal.updateMany({ where: { id: gid, status: "awaiting_approval" }, data: { status: "running" } });
      if (!claim.count) return null;
      if (!goal.newProject || goal.projectId) return { projectId: goal.projectId };
      const name = await uniqueProjectName(tx, id, goal.projectName ?? goal.text);
      const project = await tx.project.create({ data: { workspaceId: id, name, createdById: user.id } });
      await tx.goal.update({ where: { id: gid }, data: { projectId: project.id } });
      return { projectId: project.id };
    });
    if (!started) throw new HttpError(409, "conflict", "This goal has already started.");
    if (goal.brief && started.projectId) await saveBrief(id, gid, user.id, started.projectId, goal.brief).catch((e) => req.log.error(e));
    // The owner's chat attachments join the project before anyone starts working.
    if (started.projectId) await copyGoalAttachments(id, gid, user.id, started.projectId).catch((e) => req.log.error(e));
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

  app.post("/api/workspaces/:id/goals/:gid/resume", async (req) => {
    const { id, gid } = GoalParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const goal = await loadGoal(id, gid);
    if (goal.status !== "cancelled") throw new HttpError(409, "conflict", "Only a stopped goal can be resumed.");
    // A plan that was cancelled before Start was never approved: resuming it would run unapproved work.
    if (!goal.tasks.some((t) => t.startedAt || t.status === "done")) throw new HttpError(409, "conflict", "This plan was never started. Ask Nova again to make a new plan.");
    await assertNoActiveGoal(id, gid);
    const reopened = await prisma.$transaction(async (tx) => {
      const r = await tx.goal.updateMany({ where: { id: gid, status: "cancelled" }, data: { status: "running", summary: null, error: null } });
      if (!r.count) return false;
      await tx.goalTask.updateMany({ where: { goalId: gid, status: { not: "done" } }, data: { status: "pending", result: null, error: null, errorCode: null, verdict: null, verdictNote: null, startedAt: null, finishedAt: null } });
      return true;
    });
    if (!reopened) throw new HttpError(409, "conflict", "This goal was already resumed.");
    await audit(prisma, id, user.id, "goal.resume", "goal", gid);
    kickGoal(gid);
    return { ok: true };
  });

  app.post("/api/workspaces/:id/goals/:gid/replan", async (req) => {
    const { id, gid } = GoalParams.parse(req.params);
    await requireMember(req, id, "member");
    const goal = await loadGoal(id, gid);
    if (goal.status !== "failed" || goal.tasks.length) throw new HttpError(409, "conflict", "Only a goal whose planning failed can be planned again.");
    await assertNoActiveGoal(id, gid);
    await prisma.goal.update({ where: { id: gid }, data: { status: "planning", error: null } });
    planGoal(gid).catch((e) => req.log.error(e));
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
      for (const t of goal.tasks) if (!reopen.has(t.position) && (t.status === "skipped" || t.status === "interrupted") && t.dependsOn.some((d) => reopen.has(d))) (reopen.add(t.position), (grew = true));
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

  const EditParams = GoalParams.extend({ eid: z.string().min(1).max(64) });

  async function loadEdit(workspaceId: string, gid: string, eid: string) {
    const goal = await loadGoal(workspaceId, gid);
    const edit = await prisma.proposedEdit.findFirst({ where: { id: eid, goalId: goal.id } });
    if (!edit) throw new HttpError(404, "not_found", "Proposed change not found");
    return { goal, edit };
  }

  app.get("/api/workspaces/:id/goals/:gid/edits/:eid", async (req) => {
    const { id, gid, eid } = EditParams.parse(req.params);
    await requireMember(req, id);
    const { goal, edit } = await loadEdit(id, gid, eid);
    let current: string | null = null;
    if (goal.projectId) {
      const entry = await prisma.projectEntry.findUnique({ where: { projectId_pathLower: { projectId: goal.projectId, pathLower: edit.path.toLowerCase() } } });
      if (entry?.kind === "file" && entry.isText && entry.blobHash) current = (await getBlob(entry.blobHash)).toString("utf8");
    }
    return { edit: { id: edit.id, path: edit.path, content: edit.content, current, baseRevision: edit.baseRevision, status: edit.status, note: edit.note } };
  });

  app.post("/api/workspaces/:id/goals/:gid/edits/:eid/apply", async (req) => {
    const { id, gid, eid } = EditParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const { goal, edit } = await loadEdit(id, gid, eid);
    if (!goal.projectId) throw new HttpError(409, "conflict", "The project was deleted, so this change can't be applied.");
    const project = await loadProject(id, goal.projectId);
    // The edit row stays locked while saving, so a second Apply waits and then sees the decision.
    const outcome = await prisma.$transaction(
      async (tx) => {
        const [row] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM "ProposedEdit" WHERE id = ${eid} FOR UPDATE`;
        if (row?.status !== "pending") return { kind: "decided" as const };
        try {
          const saved = await saveText(project, user.id, edit.path, edit.content, edit.baseRevision);
          await tx.proposedEdit.update({ where: { id: eid }, data: { status: "applied", decidedById: user.id } });
          return { kind: "applied" as const, saved };
        } catch (e) {
          if (!(e instanceof HttpError) || e.status !== 409) throw e;
          await tx.proposedEdit.update({ where: { id: eid }, data: { status: "stale", reason: "The file changed after the companion read it.", decidedById: user.id } });
          return { kind: "stale" as const };
        }
      },
      { timeout: 60_000 },
    );
    if (outcome.kind === "decided") throw new HttpError(409, "conflict", "This change was already decided.");
    if (outcome.kind === "stale") throw new HttpError(409, "stale", "The file changed after the companion read it, so this change is out of date.");
    await audit(prisma, id, user.id, "goal.edit.apply", "proposedEdit", eid, { path: edit.path });
    return outcome.saved;
  });

  app.post("/api/workspaces/:id/goals/:gid/edits/:eid/reject", async (req) => {
    const { id, gid, eid } = EditParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    await loadEdit(id, gid, eid);
    const r = await prisma.proposedEdit.updateMany({ where: { id: eid, status: "pending" }, data: { status: "rejected", decidedById: user.id } });
    if (!r.count) throw new HttpError(409, "conflict", "This change was already decided.");
    return { ok: true };
  });
}
