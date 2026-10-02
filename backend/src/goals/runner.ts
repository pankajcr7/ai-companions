import { z } from "zod";
import { prisma } from "../db.js";
import { cap, DEP_RESULT_CAP, FILE_BUDGET, pickFiles, RESULT_CAP, type Loaded } from "./context.js";
import { checkEdit, splitEdits } from "./edits.js";
import { CallError, complete, completeJson, type Call } from "./llm.js";
import { goalContext, loadHead, loadText, stepLog } from "./load.js";
import { selectInstructions, selectPrompt, summaryInstructions, summaryPrompt, taskInstructions, taskPrompt } from "./prompts.js";

// ponytail: in-process runner; move to a job table with SKIP LOCKED if the backend ever runs as several instances.
const controllers = new Map<string, Set<AbortController>>();

export function controllerFor(goalId: string): AbortController {
  const c = new AbortController();
  let set = controllers.get(goalId);
  if (!set) controllers.set(goalId, (set = new Set()));
  set.add(c);
  return c;
}

export function release(goalId: string, c: AbortController) {
  const set = controllers.get(goalId);
  set?.delete(c);
  if (set && !set.size) controllers.delete(goalId);
}

export function abortGoal(goalId: string) {
  for (const c of controllers.get(goalId) ?? []) c.abort();
  controllers.delete(goalId);
}

const MAX_PARALLEL = 3;
const Select = z.object({ read: z.array(z.string().max(1024)).max(20) });
const Summary = z.object({
  summary: z.string().trim().min(1).max(6000),
  verdicts: z.array(z.object({ position: z.number().int().min(0), verdict: z.enum(["meets", "needs_eyes"]), note: z.string().max(500).optional().default("") })).max(6),
});
const BLOCKED = new Set(["failed", "skipped", "interrupted"]);

export function kickGoal(goalId: string) {
  void tick(goalId).catch((e) => console.error("goal runner", e));
}

/** Skips tasks that can no longer run, starts ready ones up to the cap, and finishes the goal when nothing is open. */
async function tick(goalId: string) {
  const goal = await prisma.goal.findUnique({ where: { id: goalId }, include: { tasks: true } });
  if (!goal || goal.status !== "running") return;
  const status = new Map(goal.tasks.map((t) => [t.position, t.status as string]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of goal.tasks) {
      if (status.get(t.position) === "pending" && t.dependsOn.some((d) => BLOCKED.has(status.get(d) ?? ""))) {
        status.set(t.position, "skipped");
        changed = true;
      }
    }
  }
  const skip = goal.tasks.filter((t) => t.status === "pending" && status.get(t.position) === "skipped").map((t) => t.id);
  if (skip.length) await prisma.goalTask.updateMany({ where: { id: { in: skip }, status: "pending" }, data: { status: "skipped", error: "Skipped because a task it waits for didn't finish." } });
  const running = [...status.values()].filter((s) => s === "running").length;
  const ready = goal.tasks.filter((t) => status.get(t.position) === "pending" && t.dependsOn.every((d) => status.get(d) === "done"));
  // Claim together so ready tasks start together; the conditional update keeps overlapping ticks from starting one twice.
  await Promise.all(
    ready.slice(0, Math.max(0, MAX_PARALLEL - running)).map(async (t) => {
      const claimed = await prisma.goalTask.updateMany({ where: { id: t.id, status: "pending" }, data: { status: "running", startedAt: new Date() } });
      if (claimed.count) void runTask(goalId, t.id).finally(() => kickGoal(goalId));
    }),
  );
  if (![...status.values()].some((s) => s === "pending" || s === "running")) await finishGoal(goalId);
}

async function runTask(goalId: string, taskId: string) {
  const task = await prisma.goalTask.findUniqueOrThrow({
    where: { id: taskId },
    include: { agent: { include: { connection: true, department: true } }, goal: { include: { workspace: true, project: true, tasks: { include: { agent: { select: { name: true } } } } } } },
  });
  const { goal, agent } = task;
  const ctl = controllerFor(goalId);
  const signal = AbortSignal.any([ctl.signal, AbortSignal.timeout(300_000)]);
  let input = 0;
  let output = 0;
  const add = (c: Call) => {
    input += c.inputTokens ?? 0;
    output += c.outputTokens ?? 0;
  };
  try {
    const ctx = await goalContext(goal.project);
    let files: Loaded[] = [];
    const notes: string[] = [];
    if (ctx.entries) {
      try {
        const pick = await completeJson(agent, selectInstructions(20), selectPrompt(task, ctx), Select, signal, stepLog(goal.workspaceId, goalId, taskId, "select"));
        pick.calls.forEach(add);
        const picked = await pickFiles(pick.value.read, ctx.entries, FILE_BUDGET, loadText);
        files = picked.files;
        if (picked.skipped.length) notes.push(`Some requested files were not included: ${picked.skipped.map((s) => `${s.path} (${s.reason})`).join(", ")}.`);
      } catch (e) {
        if (!(e instanceof CallError) || e.code !== "bad_output") throw e;
        notes.push("Choosing files failed, so no project files were read.");
      }
    }
    const deps = goal.tasks
      .filter((t) => task.dependsOn.includes(t.position))
      .sort((a, b) => a.position - b.position)
      .map((t) => ({ title: t.title, agentName: t.agent.name, result: cap(t.result ?? "", DEP_RESULT_CAP, "result") }));
    const call = await complete(
      agent,
      taskInstructions(agent, goal.workspace.name, agent.department?.name ?? null, !!goal.project),
      [{ role: "user", content: taskPrompt(task, goal.text, ctx, deps, files, notes.join(" ")) }],
      signal,
      stepLog(goal.workspaceId, goalId, taskId, "execute"),
    );
    add(call);
    const split = goal.project ? splitEdits(call.text) : { visible: call.text.trim(), edits: [], error: null };
    const read = new Map(files.map((f) => [f.path.toLowerCase(), f]));
    const existing = new Map((ctx.entries ?? []).map((e) => [e.path.toLowerCase(), e]));
    const checked = split.edits.map((raw) => ({ raw, check: checkEdit(raw, read, existing) }));
    const result = cap([split.visible, split.error].filter(Boolean).join("\n\n"), RESULT_CAP, "result");
    await prisma.$transaction(async (tx) => {
      const r = await tx.goalTask.updateMany({
        where: { id: taskId, status: "running" },
        data: { status: "done", result, filesRead: files.map((f) => ({ path: f.path, revision: f.revision })), contextRevisions: ctx.sharedRevisions, inputTokens: input, outputTokens: output, finishedAt: new Date() },
      });
      if (!r.count) return; // cancelled while working
      if (checked.length) {
        await tx.proposedEdit.createMany({
          data: checked.map(({ raw, check }) => ({ taskId, goalId, path: check.path, baseRevision: check.baseRevision, content: raw.content, note: raw.note, status: check.status, reason: check.reason })),
        });
      }
    });
  } catch (e) {
    const err = e instanceof CallError ? e : new CallError("server_error", "Something went wrong while working on this task.");
    if (!(e instanceof CallError)) console.error("goal task", e);
    if (err.code === "reauth" && agent.connection) await prisma.providerConnection.update({ where: { id: agent.connection.id }, data: { status: "reauth", lastError: "Sign in to ChatGPT again" } });
    await prisma.goalTask.updateMany({
      where: { id: taskId, status: "running" },
      data: { status: err.code === "aborted" ? "skipped" : "failed", error: err.code === "aborted" ? "Cancelled" : err.message, errorCode: err.code, inputTokens: input, outputTokens: output, finishedAt: new Date() },
    });
  } finally {
    release(goalId, ctl);
    if (input || output) await prisma.goal.update({ where: { id: goalId }, data: { inputTokens: { increment: input }, outputTokens: { increment: output } } });
  }
}

async function finishGoal(goalId: string) {
  const claimed = await prisma.goal.updateMany({ where: { id: goalId, status: "running" }, data: { status: "reviewing" } });
  if (!claimed.count) return;
  const goal = await prisma.goal.findUniqueOrThrow({ where: { id: goalId }, include: { workspace: true, project: true, tasks: { orderBy: { position: "asc" }, include: { agent: { select: { name: true } } } } } });
  const ctl = controllerFor(goalId);
  try {
    const nova = await loadHead(goal.workspaceId);
    if (!nova) throw new CallError("unassigned", "Your company has no head agent");
    const ctx = await goalContext(goal.project);
    const rows = goal.tasks.map((t) => ({ position: t.position, title: t.title, agentName: t.agent.name, status: t.status, criteria: t.criteria, result: t.result, error: t.error }));
    const signal = AbortSignal.any([ctl.signal, AbortSignal.timeout(300_000)]);
    const { value, calls } = await completeJson(nova, summaryInstructions(goal.workspace.name), summaryPrompt(goal.text, ctx.shared, rows), Summary, signal, stepLog(goal.workspaceId, goalId, null, "summary"));
    const done = new Map(goal.tasks.filter((t) => t.status === "done").map((t) => [t.position, t.id]));
    await prisma.$transaction(async (tx) => {
      for (const v of value.verdicts) {
        const id = done.get(v.position);
        if (id) await tx.goalTask.update({ where: { id }, data: { verdict: v.verdict, verdictNote: v.note || null } });
      }
      await tx.goal.updateMany({
        where: { id: goalId, status: "reviewing" },
        data: { status: "done", summary: value.summary, inputTokens: { increment: calls.reduce((n, c) => n + (c.inputTokens ?? 0), 0) }, outputTokens: { increment: calls.reduce((n, c) => n + (c.outputTokens ?? 0), 0) } },
      });
    });
  } catch (e) {
    if (!(e instanceof CallError)) console.error("goal summary", e);
    const message = e instanceof CallError ? e.message : "Something went wrong.";
    await prisma.goal.updateMany({ where: { id: goalId, status: "reviewing" }, data: { status: "done", error: `Nova couldn't write the summary: ${message}` } });
  } finally {
    release(goalId, ctl);
  }
}

/** Work that was running when the server stopped is marked so the owner can retry it; nothing reruns by itself. */
export async function recoverInterrupted() {
  await prisma.goalTask.updateMany({ where: { status: "running" }, data: { status: "interrupted", error: "Interrupted by a server restart. Retry to run it again." } });
  await prisma.goal.updateMany({ where: { status: { in: ["planning", "running", "reviewing"] } }, data: { status: "failed", error: "Interrupted by a server restart." } });
}
