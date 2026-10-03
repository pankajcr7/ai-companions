import { prisma } from "../db.js";
import type { Project, StepPhase } from "../generated/prisma/client.js";
import { getBlob } from "../files/store.js";
import { projectMap, revisionKey, sharedContext, type ProjectFile } from "./context.js";
import { readiness, type StepLog } from "./llm.js";
import type { RosterEntry } from "./prompts.js";

export const loadHead = (workspaceId: string) => prisma.agent.findFirst({ where: { workspaceId, isHead: true }, include: { connection: true } });

export const loadText = async (hash: string) => (await getBlob(hash)).toString("utf8");

export type GoalContext = { shared: string; sharedRevisions: Record<string, number>; summary: string | null; map: string | null; entries: ProjectFile[] | null };

/** Everything a prompt needs from the linked project: brief/brand, a fresh summary, and the file map. */
export async function goalContext(project: Project | null): Promise<GoalContext> {
  if (!project) return { shared: "", sharedRevisions: {}, summary: null, map: null, entries: null };
  const rows = await prisma.projectEntry.findMany({ where: { projectId: project.id }, orderBy: { path: "asc" } });
  const entries: ProjectFile[] = rows.map((r) => ({ path: r.path, kind: r.kind, size: r.size, isText: r.isText, revision: r.revision, blobHash: r.blobHash }));
  const parts: { brief?: string; brand?: string } = {};
  const sharedRevisions: Record<string, number> = {};
  for (const r of rows) {
    if (r.kind !== "file" || !r.blobHash || (r.pathLower !== ".company/brief.md" && r.pathLower !== ".company/brand.md")) continue;
    parts[r.pathLower === ".company/brief.md" ? "brief" : "brand"] = await loadText(r.blobHash);
    sharedRevisions[r.path] = r.revision;
  }
  const fresh = project.summary && project.summaryRevisionKey === revisionKey(rows) ? project.summary : null;
  return { shared: sharedContext(parts), sharedRevisions, summary: fresh, map: projectMap(entries), entries };
}

export const stepLog =
  (workspaceId: string, goalId: string | null, taskId: string | null, phase: StepPhase): StepLog =>
  async (s) => {
    await prisma.goalStep.create({ data: { workspaceId, goalId, taskId, phase, ...s } });
  };

/** Active AI companions as Nova sees them: who they are and whether they can work yet. */
export async function loadRoster(workspaceId: string): Promise<RosterEntry[]> {
  const agents = await prisma.agent.findMany({ where: { workspaceId, kind: "ai", status: "active" }, include: { department: true, connection: true }, orderBy: { createdAt: "asc" } });
  return agents.map((a) => ({ id: a.id, name: a.name, role: a.role, workingStyle: a.workingStyle, department: a.department?.name ?? null, ready: readiness(a) === null }));
}
