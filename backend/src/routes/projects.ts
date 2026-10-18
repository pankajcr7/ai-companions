import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { entryDTO, loadEntry, loadProject, ProjectParams, projectDTO, requirePath, sendFile } from "../files/service.js";
import { getBlob } from "../files/store.js";
import { writeZip } from "../files/zip.js";
import { revisionKey } from "../goals/context.js";
import { CallError, readiness } from "../goals/llm.js";
import { loadHead } from "../goals/load.js";
import { summarizeProject } from "../goals/summary.js";
import { audit, HttpError, perUser, requireMember } from "../http.js";
import { Name, WsParams } from "./workspaces.js";
import { projectCover } from "../files/overview.js";

export async function projectRoutes(app: FastifyInstance) {
  app.get("/api/workspaces/:id/projects", async (req) => {
    const { id } = WsParams.parse(req.params);
    await requireMember(req, id);
    if ((req.query as { overview?: string }).overview === "1") {
      const rows = await prisma.project.findMany({
        where: { workspaceId: id }, orderBy: { updatedAt: "desc" },
        include: {
          entries: { where: { kind: "file" }, select: { path: true, revision: true }, orderBy: { path: "asc" } },
          goals: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, text: true, status: true, tasks: { select: { agentId: true, status: true } }, _count: { select: { edits: { where: { status: "pending" } } } } } },
        },
      });
      return { projects: rows.map((p) => {
        const g = p.goals[0];
        return { ...projectDTO(p), overview: { cover: projectCover(p.entries), screens: p.entries.filter((e) => /^screens\/[^/]+\.html?$/i.test(e.path)).length, goal: g ? { id: g.id, text: g.text, status: g.status, done: g.tasks.filter((t) => t.status === "done").length, total: g.tasks.length, pendingEdits: g._count.edits, agentIds: [...new Set(g.tasks.map((t) => t.agentId))] } : null } };
      }) };
    }
    const rows = await prisma.project.findMany({ where: { workspaceId: id }, orderBy: { updatedAt: "desc" } });
    return { projects: rows.map(projectDTO) };
  });

  app.post("/api/workspaces/:id/projects", async (req, reply) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const { name } = z.object({ name: Name }).parse(req.body);
    const p = await prisma.project.create({ data: { workspaceId: id, name, createdById: user.id } });
    await audit(prisma, id, user.id, "project.create", "project", p.id, { name });
    return reply.code(201).send({ id: p.id });
  });

  app.patch("/api/workspaces/:id/projects/:pid", async (req) => {
    const { id, pid } = ProjectParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const { name } = z.object({ name: Name }).parse(req.body);
    await loadProject(id, pid);
    await prisma.project.update({ where: { id: pid }, data: { name } });
    await audit(prisma, id, user.id, "project.rename", "project", pid, { name });
    return { ok: true };
  });

  app.delete("/api/workspaces/:id/projects/:pid", async (req, reply) => {
    const { id, pid } = ProjectParams.parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    await loadProject(id, pid);
    await prisma.project.delete({ where: { id: pid } });
    await audit(prisma, id, user.id, "project.delete", "project", pid);
    return reply.code(204).send();
  });

  app.get("/api/workspaces/:id/projects/:pid/tree", async (req) => {
    const { id, pid } = ProjectParams.parse(req.params);
    await requireMember(req, id);
    const project = await loadProject(id, pid);
    const entries = await prisma.projectEntry.findMany({ where: { projectId: pid }, orderBy: { path: "asc" } });
    const summary = project.summary
      ? { text: project.summary, summarizedAt: project.summarizedAt, stale: project.summaryRevisionKey !== revisionKey(entries) }
      : null;
    return { project: projectDTO(project), entries: entries.map(entryDTO), summary };
  });

  app.get("/api/workspaces/:id/projects/:pid/download", async (req, reply) => {
    const { id, pid } = ProjectParams.parse(req.params);
    await requireMember(req, id);
    await loadProject(id, pid);
    const path = requirePath((req.query as { path?: string }).path);
    const entry = await loadEntry(pid, path);
    if (entry.kind !== "file" || !entry.blobHash) throw new HttpError(400, "invalid", "That's a folder; download the project ZIP instead");
    return sendFile(reply, path.split("/").pop()!, await getBlob(entry.blobHash));
  });

  app.get("/api/workspaces/:id/projects/:pid/download.zip", async (req, reply) => {
    const { id, pid } = ProjectParams.parse(req.params);
    await requireMember(req, id);
    const project = await loadProject(id, pid);
    const entries = await prisma.projectEntry.findMany({ where: { projectId: pid }, orderBy: { path: "asc" } });
    const items = [];
    for (const e of entries) items.push(e.kind === "dir" ? { path: e.path, isDir: true } : { path: e.path, isDir: false, data: await getBlob(e.blobHash!) });
    return sendFile(reply, `${project.name}.zip`, writeZip(items), true);
  });

  app.post(
    "/api/workspaces/:id/projects/:pid/summarize",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute", keyGenerator: perUser } } },
    async (req) => {
      const { id, pid } = ProjectParams.parse(req.params);
      await requireMember(req, id, "member");
      const project = await loadProject(id, pid);
      const nova = await loadHead(id);
      const problem = nova ? readiness(nova) : "Your company has no head agent";
      if (problem || !nova) throw new HttpError(409, "unassigned", `${problem}. Choose a model on the companion's Customize form.`);
      const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id } });
      try {
        const s = await summarizeProject(project, nova, workspace.name);
        return { summary: { ...s, stale: false } };
      } catch (e) {
        if (e instanceof CallError) throw new HttpError(502, e.code, `Nova couldn't summarize the project: ${e.message}`);
        throw e;
      }
    },
  );
}
