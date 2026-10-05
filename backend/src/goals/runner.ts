import { z } from "zod";
import { prisma } from "../db.js";
import { saveText } from "../files/service.js";
import { HttpError } from "../http.js";
import { cap, DEP_RESULT_CAP, FILE_BUDGET, pickFiles, RESULT_CAP, type Loaded } from "./context.js";
import { checkEdit, splitEdits } from "./edits.js";
import { CallError, completeJson, type Call } from "./llm.js";
import { runLoop, ToolError } from "../harness/loop.js";
import { projectTools, webTools, type Write } from "../harness/tools.js";
import { loadSearchKey } from "../harness/web.js";
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
      if (claimed.count) void runTask(goalId, t.id).catch((e) => console.error("goal task", e)).finally(() => kickGoal(goalId));
    }),
  );
  if (![...status.values()].some((s) => s === "pending" || s === "running")) await finishGoal(goalId);
}

// A task may make many slow model calls (reading, writing whole files), so it gets far longer than one call.
const taskLimitMs = () => Number(process.env.TASK_TIME_LIMIT_MS) || 30 * 60_000;

async function runTask(goalId: string, taskId: string) {
  const ctl = controllerFor(goalId);
  const limit = AbortSignal.timeout(taskLimitMs());
  const signal = AbortSignal.any([ctl.signal, limit]);
  let input = 0;
  let output = 0;
  let connectionId: string | null = null;
  const add = (c: Call) => {
    input += c.inputTokens ?? 0;
    output += c.outputTokens ?? 0;
  };
  type Decided = { raw: { path: string; content: string; note: string }; check: { path: string; baseRevision: number; status: "pending" | "rejected" | "applied"; reason: string | null }; decidedById: string | null };
  const decided: Decided[] = [];
  const editRow = ({ raw, check, decidedById }: Decided) => ({ taskId, goalId, path: check.path, baseRevision: check.baseRevision, content: raw.content, note: raw.note, status: check.status, reason: check.reason, decidedById });
  try {
    // Loaded inside the try so a database error fails this task instead of escaping the runner.
    const task = await prisma.goalTask.findUniqueOrThrow({
      where: { id: taskId },
      include: { agent: { include: { connection: true, department: true } }, goal: { include: { workspace: true, project: true, tasks: { include: { agent: { select: { name: true } } } } } } },
    });
    const { goal, agent } = task;
    connectionId = agent.connection?.id ?? null;
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
    const read = new Map(files.map((f) => [f.path.toLowerCase(), f]));
    const existing = new Map((ctx.entries ?? []).map((e) => [e.path.toLowerCase(), e]));
    // A goal that created its project saves new files right away; anything else waits for Apply.
    const saveOrSuggest = async (w: Write) => {
      const raw = { path: w.path, content: w.content, note: w.note };
      if (!goal.newProject || !goal.project || w.baseRevision !== 0) {
        decided.push({ raw, check: { path: w.path, baseRevision: w.baseRevision, status: "pending", reason: null }, decidedById: null });
        return "Saved as a suggestion for the owner to review.";
      }
      if (signal.aborted) throw new CallError("aborted", "Stopped");
      try {
        await saveText(goal.project, goal.createdById, w.path, w.content, 0);
        decided.push({ raw, check: { path: w.path, baseRevision: 0, status: "applied", reason: null }, decidedById: goal.createdById });
        return `Saved ${w.path}.`;
      } catch (e) {
        // P2002: a task running alongside created the same file a moment earlier.
        const reason = e instanceof HttpError ? e.message : (e as { code?: string }).code === "P2002" ? "Another task already created this file." : null;
        if (!reason) throw e;
        decided.push({ raw, check: { path: w.path, baseRevision: 0, status: "rejected", reason }, decidedById: null });
        throw new ToolError(`Not saved: ${reason}`);
      }
    };
    const tools = [...(goal.project ? projectTools(goal.project, { write: saveOrSuggest, read }) : []), ...webTools(await loadSearchKey(goal.workspaceId))];
    const loop = await runLoop({
      actor: agent,
      instructions: taskInstructions(agent, goal.workspace.name, agent.department?.name ?? null, !!goal.project),
      turns: [{ role: "user", content: taskPrompt(task, goal.text, ctx, deps, files, notes.join(" ")) }],
      tools,
      limit: 12,
      signal,
      log: stepLog(goal.workspaceId, goalId, taskId, "execute"),
      // Counted per call, so a stopped task still reports what it used.
      onCall: add,
    });
    // Fallback for models that answer with an edits block instead of tools: today's rules apply.
    const split = goal.project ? splitEdits(loop.text) : { visible: loop.text.trim(), edits: [], error: null };
    for (const raw of split.edits) {
      const check = checkEdit(raw, read, existing);
      if (check.status === "pending" && check.baseRevision === 0 && goal.newProject && goal.project) {
        await saveOrSuggest({ path: check.path, content: raw.content, note: raw.note ?? "", baseRevision: 0 }).catch((e) => {
          if (!(e instanceof ToolError)) throw e;
        });
      } else decided.push({ raw: { path: check.path, content: raw.content, note: raw.note ?? "" }, check: { ...check, reason: check.reason ?? null }, decidedById: null });
    }
    const result = cap([split.visible, split.error].filter(Boolean).join("\n\n"), RESULT_CAP, "result");
    const filesRead = [...read.values()].map((f) => ({ path: f.path, revision: f.revision }));
    await prisma.$transaction(async (tx) => {
      const r = await tx.goalTask.updateMany({
        // startedAt pins this run: after Stop and Resume, a newer run owns the task.
        where: { id: taskId, status: "running", startedAt: task.startedAt },
        data: { status: "done", result, filesRead, toolUses: loop.toolUses, contextRevisions: ctx.sharedRevisions, inputTokens: input, outputTokens: output, finishedAt: new Date() },
      });
      // Cancelled while working: only files already saved are recorded, so every saved file is listed.
      const rows = r.count ? decided : decided.filter((d) => d.check.status === "applied");
      if (rows.length) {
        await tx.proposedEdit.createMany({
          data: rows.map(editRow),
        });
      }
    });
  } catch (e) {
    // The time limit ran out (not the owner's Stop): say so plainly, so it can be retried.
    const timedOut = limit.aborted && !ctl.signal.aborted;
    const err = timedOut
      ? new CallError("timeout", `Took longer than ${Math.round(taskLimitMs() / 60_000)} minutes, so it was stopped. Try again, or split it into smaller tasks.`)
      : e instanceof CallError
        ? e
        : new CallError("server_error", "Something went wrong while working on this task.");
    if (!(e instanceof CallError)) console.error("goal task", e);
    if (err.code === "reauth" && connectionId) await prisma.providerConnection.update({ where: { id: connectionId }, data: { status: "reauth", lastError: "Sign in to ChatGPT again" } });
    // Files already saved before Stop or a failure stay listed, so nothing in the project is unaccounted for.
    const saved = decided.filter((d) => d.check.status === "applied");
    if (saved.length) await prisma.proposedEdit.createMany({ data: saved.map(editRow) }).catch((e2) => console.error("goal task edits", e2));
    await prisma.goalTask.updateMany({
      where: { id: taskId, status: "running" },
      data: { status: err.code === "aborted" ? "skipped" : "failed", error: err.code === "aborted" ? "Cancelled" : err.message, errorCode: err.code, inputTokens: input, outputTokens: output, finishedAt: new Date() },
    });
  } finally {
    release(goalId, ctl);
    if (input || output) await prisma.goal.update({ where: { id: goalId }, data: { inputTokens: { increment: input }, outputTokens: { increment: output } } }).catch((e) => console.error("goal tokens", e));
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
    const signal = AbortSignal.any([ctl.signal, AbortSignal.timeout(15 * 60_000)]);
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
  const interrupted = { status: "interrupted" as const, error: "Interrupted by a server restart. Retry to run it again." };
  await prisma.goalTask.updateMany({ where: { status: "running" }, data: interrupted });
  // Tasks still waiting in a running goal would otherwise be stranded: the goal fails below and has nothing to retry.
  await prisma.goalTask.updateMany({ where: { status: "pending", goal: { status: "running" } }, data: interrupted });
  await prisma.goal.updateMany({ where: { status: { in: ["planning", "running", "reviewing"] } }, data: { status: "failed", error: "Interrupted by a server restart." } });
}
