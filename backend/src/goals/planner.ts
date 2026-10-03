import { z } from "zod";
import { prisma } from "../db.js";
import { CallError, completeJson, readiness } from "./llm.js";
import { goalContext, loadHead, stepLog } from "./load.js";
import { normalizeAssignees, Plan, planProblems } from "./plan.js";
import { planInstructions, planPrompt, previousGoal } from "./prompts.js";
import { controllerFor, release } from "./runner.js";

/** Asks Nova for a plan; stores tasks and waits for approval, unless the goal was cancelled meanwhile. */
export async function planGoal(goalId: string): Promise<void> {
  const ctl = controllerFor(goalId);
  try {
    // Loaded inside the try so a database error fails the goal instead of escaping.
    const goal = await prisma.goal.findUniqueOrThrow({ where: { id: goalId }, include: { workspace: true, project: true } });
    const nova = await loadHead(goal.workspaceId);
    if (!nova) throw new CallError("unassigned", "Your company has no head agent");
    const roster = await prisma.agent.findMany({ where: { workspaceId: goal.workspaceId, kind: "ai", status: "active" }, include: { department: true, connection: true }, orderBy: { createdAt: "asc" } });
    const ids = new Set(roster.map((r) => r.id));
    const ctx = await goalContext(goal.project);
    const schema = z.preprocess(
      (raw) => normalizeAssignees(raw, roster),
      Plan.superRefine((plan, c) => {
        for (const message of planProblems(plan, ids)) c.addIssue({ code: "custom", message });
        if (goal.newProject && !plan.projectName) c.addIssue({ code: "custom", message: "projectName is required: this goal builds a new project" });
      }),
    );
    const entries = roster.map((a) => ({ id: a.id, name: a.name, role: a.role, workingStyle: a.workingStyle, department: a.department?.name ?? null, ready: readiness(a) === null }));
    const parent = goal.parentGoalId
      ? await prisma.goal.findUnique({ where: { id: goal.parentGoalId }, include: { tasks: { orderBy: { position: "asc" }, include: { agent: { select: { name: true } } } } } })
      : null;
    const previous = parent ? previousGoal({ text: parent.text, summary: parent.summary, tasks: parent.tasks.map((t) => ({ title: t.title, agentName: t.agent.name, result: t.result })) }) : null;
    const signal = AbortSignal.any([ctl.signal, AbortSignal.timeout(300_000)]);
    const { value, calls } = await completeJson(nova, planInstructions(goal.workspace.name, goal.newProject), planPrompt(goal.text, entries, ctx, previous), schema, signal, stepLog(goal.workspaceId, goalId, null, "plan"));
    const inputTokens = calls.reduce((n, c) => n + (c.inputTokens ?? 0), 0);
    const outputTokens = calls.reduce((n, c) => n + (c.outputTokens ?? 0), 0);
    await prisma.$transaction(async (tx) => {
      const r = await tx.goal.updateMany({ where: { id: goalId, status: "planning" }, data: { status: "awaiting_approval", error: null, projectName: goal.newProject ? (value.projectName ?? null) : null, inputTokens: { increment: inputTokens }, outputTokens: { increment: outputTokens } } });
      if (!r.count) return;
      await tx.goalTask.createMany({ data: value.tasks.map((t, position) => ({ goalId, position, ...t })) });
    });
  } catch (e) {
    if (!(e instanceof CallError)) console.error(e);
    const message = e instanceof CallError ? e.message : "Something went wrong while planning.";
    await prisma.goal.updateMany({ where: { id: goalId, status: "planning" }, data: { status: "failed", error: `Nova couldn't make a plan: ${message}` } });
  } finally {
    release(goalId, ctl);
  }
}
