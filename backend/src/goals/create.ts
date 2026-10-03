import { prisma } from "../db.js";
import { loadProject } from "../files/service.js";
import { audit, HttpError } from "../http.js";
import { readiness } from "./llm.js";
import { loadHead } from "./load.js";
import { planGoal } from "./planner.js";

export const ACTIVE = ["planning", "running", "reviewing"] as const;

/** Creates a goal and starts planning. Shared by POST /goals and the chat home's automatic plans. */
export async function createGoal(o: { workspaceId: string; userId: string; text: string; projectId?: string | null; parentGoalId?: string | null; newProject?: boolean; log?: (e: unknown) => void }) {
  const id = o.workspaceId;
  let projectId = o.projectId ?? null;
  if (o.parentGoalId) {
    const parent = await prisma.goal.findFirst({ where: { id: o.parentGoalId, workspaceId: id } });
    if (!parent) throw new HttpError(404, "not_found", "Goal not found");
    if (o.projectId === undefined) projectId = parent.projectId;
  }
  // A goal that builds something new gets its own project when it starts.
  if (o.newProject) projectId = null;
  if (projectId) await loadProject(id, projectId);
  const nova = await loadHead(id);
  const problem = nova ? readiness(nova) : "Your company has no head agent";
  if (problem) throw new HttpError(409, "unassigned", `${problem}. Choose a model on the companion's Customize form.`);
  // One check-and-create at a time per company, so a double submit can't start two goals.
  const goal = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
    const busy = await tx.goal.findFirst({ where: { workspaceId: id, status: { in: [...ACTIVE] } } });
    if (busy) throw new HttpError(409, "busy", "Another goal is still in progress. Wait for it to finish or cancel it.");
    return tx.goal.create({ data: { workspaceId: id, projectId, parentGoalId: o.parentGoalId ?? null, newProject: o.newProject ?? false, text: o.text, createdById: o.userId } });
  });
  await audit(prisma, id, o.userId, "goal.create", "goal", goal.id);
  planGoal(goal.id).catch((e) => (o.log ?? console.error)(e));
  return { id: goal.id };
}
