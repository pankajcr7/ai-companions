import { z } from "zod";

export const PlanTask = z.object({
  agentId: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(120),
  instructions: z.string().trim().min(1).max(4000),
  deliverable: z.string().trim().min(1).max(300),
  criteria: z.array(z.string().trim().min(1).max(300)).min(1).max(5),
  dependsOn: z.array(z.number().int().min(0).max(5)).max(5).default([]),
});
export const Plan = z.object({ projectName: z.string().trim().min(1).max(60).optional(), tasks: z.array(PlanTask).min(1).max(6) });
export type PlanT = z.infer<typeof Plan>;

/** Problems the schema can't see: unknown assignees, bad dependency indexes, loops. */
export function planProblems(plan: PlanT, agentIds: Set<string>): string[] {
  const problems: string[] = [];
  plan.tasks.forEach((t, i) => {
    if (!agentIds.has(t.agentId)) problems.push(`Task ${i}: agentId "${t.agentId}" is not on the roster`);
    for (const d of t.dependsOn) if (d === i || d >= plan.tasks.length) problems.push(`Task ${i}: dependsOn ${d} is not another task's index`);
  });
  if (!problems.length && hasCycle(plan.tasks.map((t) => t.dependsOn))) problems.push("Tasks depend on each other in a loop");
  return problems;
}

export function hasCycle(deps: number[][]): boolean {
  const state = deps.map(() => 0); // 0 unseen, 1 visiting, 2 done
  const visit = (i: number): boolean => {
    if (state[i] === 1) return true;
    if (state[i] === 2) return false;
    state[i] = 1;
    if (deps[i].some(visit)) return true;
    state[i] = 2;
    return false;
  };
  return deps.some((_, i) => visit(i));
}

/** The JSON in a model reply: the last fenced block, otherwise the outermost braces. */
export function extractJson(text: string): unknown {
  const fenced = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].at(-1)?.[1];
  const start = text.indexOf("{");
  const candidate = fenced ?? (start >= 0 ? text.slice(start, text.lastIndexOf("}") + 1) : "");
  if (!candidate.trim()) throw new Error("No JSON found in the reply");
  return JSON.parse(candidate);
}

/** Models sometimes write a companion's name instead of its id; map exact names (any case) to ids. */
export function normalizeAssignees(raw: unknown, roster: { id: string; name: string }[]): unknown {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { tasks?: unknown }).tasks)) return raw;
  const ids = new Set(roster.map((r) => r.id));
  const byName = new Map(roster.map((r) => [r.name.toLowerCase(), r.id]));
  const tasks = (raw as { tasks: unknown[] }).tasks.map((t) => {
    if (!t || typeof t !== "object") return t;
    const agentId = (t as { agentId?: unknown }).agentId;
    if (typeof agentId !== "string" || ids.has(agentId)) return t;
    const id = byName.get(agentId.trim().toLowerCase());
    return id ? { ...t, agentId: id } : t;
  });
  return { ...raw, tasks };
}
