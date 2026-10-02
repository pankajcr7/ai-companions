import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { entryDTO, loadEntry, loadProject, ProjectParams, projectDTO, requirePath, sendFile } from "../files/service.js";
import { getBlob } from "../files/store.js";
import { writeZip } from "../files/zip.js";
import { audit, HttpError, requireMember } from "../http.js";
import { Name, WsParams } from "./workspaces.js";

export async function projectRoutes(app: FastifyInstance) {
  app.get("/api/workspaces/:id/projects", async (req) => {
    const { id } = WsParams.parse(req.params);
    await requireMember(req, id);
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
    return { project: projectDTO(project), entries: entries.map(entryDTO) };
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
}
