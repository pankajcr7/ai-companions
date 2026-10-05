import { z } from "zod";
import { prisma } from "../db.js";
import type { Project } from "../generated/prisma/client.js";
import { filesBlock, pickFiles, projectMap, revisionKey, SUMMARY_BUDGET, type ProjectFile } from "./context.js";
import { complete, completeJson, type Actor } from "./llm.js";
import { loadText, stepLog } from "./load.js";
import { projectSummaryInstructions, projectSummarySelectPrompt, selectInstructions } from "./prompts.js";

const Select = z.object({ read: z.array(z.string().max(1024)).max(30) });

/** Nova picks up to 30 key files, reads them within the budget, and writes a summary stored on the project. */
export async function summarizeProject(project: Project, nova: Actor & { workspaceId: string }, company: string): Promise<{ text: string; summarizedAt: Date }> {
  const rows = await prisma.projectEntry.findMany({ where: { projectId: project.id }, orderBy: { path: "asc" } });
  const entries: ProjectFile[] = rows.map((r) => ({ path: r.path, kind: r.kind, size: r.size, isText: r.isText, revision: r.revision, blobHash: r.blobHash }));
  const map = projectMap(entries);
  const log = stepLog(nova.workspaceId, null, null, "project_summary");
  const signal = AbortSignal.timeout(15 * 60_000);
  const pick = await completeJson(nova, selectInstructions(30), projectSummarySelectPrompt(map), Select, signal, log);
  const { files } = await pickFiles(pick.value.read, entries, SUMMARY_BUDGET, loadText);
  const call = await complete(nova, projectSummaryInstructions(company), [{ role: "user", content: `PROJECT FILES:\n${map}\n\nKEY FILES:\n${filesBlock(files)}` }], signal, log);
  const text = call.text.trim().slice(0, 6000);
  const summarizedAt = new Date();
  await prisma.project.update({ where: { id: project.id }, data: { summary: text, summaryRevisionKey: revisionKey(rows), summarizedAt } });
  return { text, summarizedAt };
}
