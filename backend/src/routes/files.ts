import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { exclusionReason, LIMITS, parentDirs, PRIVATE_KEY } from "../files/rules.js";
import { loadEntry, loadProject, ProjectParams, recount, requirePath } from "../files/service.js";
import { getBlob, isTextContent, putBlob } from "../files/store.js";
import { HttpError, perUser, requireMember } from "../http.js";

const Save = z.object({ path: z.string().max(1024), content: z.string(), baseRevision: z.number().int().min(0) });
const PathBody = z.object({ path: z.string().max(1024) });
const Move = z.object({ from: z.string().max(1024), to: z.string().max(1024) });
const Restore = z.object({ path: z.string().max(1024), revisionId: z.string().min(1).max(64) });

async function ensureParents(projectId: string, path: string, userId: string) {
  const dirs = parentDirs(path);
  if (!dirs.length) return;
  const blockers = await prisma.projectEntry.findMany({ where: { projectId, kind: "file", pathLower: { in: dirs.map((d) => d.toLowerCase()) } } });
  if (blockers.length) throw new HttpError(409, "conflict", `${blockers[0].path} is a file, not a folder`);
  await prisma.projectEntry.createMany({ data: dirs.map((d) => ({ projectId, path: d, pathLower: d.toLowerCase(), kind: "dir" as const, updatedById: userId })), skipDuplicates: true });
}

function checkAllowed(path: string, kind: "file" | "dir") {
  const reason = exclusionReason(path, kind);
  if (reason) throw new HttpError(400, "invalid", `This isn't allowed in projects: ${reason}`);
}

const findPath = (projectId: string, path: string) => prisma.projectEntry.findUnique({ where: { projectId_pathLower: { projectId, pathLower: path.toLowerCase() } } });

export async function fileRoutes(app: FastifyInstance) {
  const saveLimit = { config: { rateLimit: { max: 60, timeWindow: "1 minute", keyGenerator: perUser } } };

  app.get("/api/workspaces/:id/projects/:pid/files", async (req) => {
    const { id, pid } = ProjectParams.parse(req.params);
    await requireMember(req, id);
    await loadProject(id, pid);
    const path = requirePath((req.query as { path?: string }).path);
    const entry = await loadEntry(pid, path);
    if (entry.kind !== "file" || !entry.isText || entry.size > LIMITS.maxEditorBytes) {
      throw new HttpError(415, "not_text", "This file can't be opened in the editor. Download it instead.");
    }
    return { path: entry.path, content: (await getBlob(entry.blobHash!)).toString("utf8"), revision: entry.revision };
  });

  app.put("/api/workspaces/:id/projects/:pid/files", saveLimit, async (req) => {
    const { id, pid } = ProjectParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const project = await loadProject(id, pid);
    const body = Save.parse(req.body);
    const path = requirePath(body.path);
    checkAllowed(path, "file");
    const data = Buffer.from(body.content, "utf8");
    if (data.length > LIMITS.maxEditorBytes) throw new HttpError(413, "too_large", "Files edited here can be up to 1 MB");
    if (PRIVATE_KEY.test(body.content)) throw new HttpError(400, "invalid", "This file contains a private key, which isn't allowed in projects");
    const existing = await findPath(pid, path);
    const growth = data.length - (existing?.size ?? 0);
    if (project.totalBytes + growth > LIMITS.maxTotalBytes) throw new HttpError(413, "too_large", "The project has reached 50 MB");

    if (body.baseRevision === 0) {
      if (existing) throw new HttpError(409, "conflict", "A file or folder with this name already exists");
      const entries = await prisma.projectEntry.count({ where: { projectId: pid } });
      if (entries + 1 + parentDirs(path).length > LIMITS.maxEntries) throw new HttpError(413, "too_large", "The project has reached 2,000 files and folders");
      const blobHash = await putBlob(data);
      await ensureParents(pid, path, user.id);
      await prisma.$transaction(async (tx) => {
        const entry = await tx.projectEntry.create({ data: { projectId: pid, path, pathLower: path.toLowerCase(), kind: "file", blobHash, size: data.length, isText: true, revision: 1, updatedById: user.id } });
        await tx.fileRevision.create({ data: { entryId: entry.id, projectId: pid, blobHash, size: data.length, revision: 1, reason: "edit", createdById: user.id } });
        await recount(tx, pid);
      });
      return { revision: 1 };
    }

    if (!existing || existing.kind !== "file") throw new HttpError(404, "not_found", "File not found");
    if (!existing.isText) throw new HttpError(415, "not_text", "Binary files can't be edited here");
    const blobHash = await putBlob(data);
    const next = body.baseRevision + 1;
    const updated = await prisma.$transaction(async (tx) => {
      // Conditional update: only succeeds if nobody saved since this revision was opened.
      const r = await tx.projectEntry.updateMany({
        where: { id: existing.id, revision: body.baseRevision },
        data: { blobHash, size: data.length, revision: next, updatedById: user.id },
      });
      if (r.count === 0) return false;
      await tx.fileRevision.create({ data: { entryId: existing.id, projectId: pid, blobHash, size: data.length, revision: next, reason: "edit", createdById: user.id } });
      await recount(tx, pid);
      return true;
    });
    if (!updated) throw new HttpError(409, "conflict", "This file changed since you opened it. Reload to see the latest version.");
    return { revision: next };
  });

  app.post("/api/workspaces/:id/projects/:pid/folders", async (req, reply) => {
    const { id, pid } = ProjectParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    await loadProject(id, pid);
    const path = requirePath(PathBody.parse(req.body).path);
    checkAllowed(path, "dir");
    if (await findPath(pid, path)) throw new HttpError(409, "conflict", "A file or folder with this name already exists");
    const entries = await prisma.projectEntry.count({ where: { projectId: pid } });
    if (entries + 1 + parentDirs(path).length > LIMITS.maxEntries) throw new HttpError(413, "too_large", "The project has reached 2,000 files and folders");
    await ensureParents(pid, path, user.id);
    await prisma.projectEntry.create({ data: { projectId: pid, path, pathLower: path.toLowerCase(), kind: "dir", updatedById: user.id } });
    return reply.code(201).send({ ok: true });
  });

  app.post("/api/workspaces/:id/projects/:pid/move", async (req) => {
    const { id, pid } = ProjectParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    await loadProject(id, pid);
    const body = Move.parse(req.body);
    const to = requirePath(body.to);
    const entry = await loadEntry(pid, requirePath(body.from));
    const from = entry.path;
    checkAllowed(to, entry.kind);
    if (to.toLowerCase().startsWith(`${from.toLowerCase()}/`)) throw new HttpError(400, "invalid", "A folder can't be moved into itself");
    const sameEntry = to.toLowerCase() === from.toLowerCase();
    if (!sameEntry && (await findPath(pid, to))) throw new HttpError(409, "conflict", "Something with that name already exists there");
    await ensureParents(pid, to, user.id);
    const fromLower = entry.pathLower;
    await prisma.$transaction(async (tx) => {
      // One statement renames the entry and everything under it (starts_with avoids LIKE wildcards).
      await tx.$executeRaw`
        UPDATE "ProjectEntry"
        SET "path" = ${to}::text || substr("path", char_length(${from}::text) + 1),
            "pathLower" = ${to.toLowerCase()}::text || substr("pathLower", char_length(${fromLower}::text) + 1),
            "updatedAt" = now()
        WHERE "projectId" = ${pid} AND ("pathLower" = ${fromLower}::text OR starts_with("pathLower", ${`${fromLower}/`}::text))`;
      if (entry.kind === "file") {
        await tx.fileRevision.create({ data: { entryId: entry.id, projectId: pid, blobHash: entry.blobHash!, size: entry.size, revision: entry.revision, reason: "rename", fromPath: from, createdById: user.id } });
      }
    });
    return { ok: true };
  });

  app.delete("/api/workspaces/:id/projects/:pid/entries", async (req, reply) => {
    const { id, pid } = ProjectParams.parse(req.params);
    await requireMember(req, id, "member");
    await loadProject(id, pid);
    const path = requirePath((req.query as { path?: string }).path);
    const entry = await loadEntry(pid, path);
    await prisma.$transaction(async (tx) => {
      // starts_with, not Prisma's startsWith: LIKE would treat _ and % in folder names as wildcards.
      await tx.$executeRaw`DELETE FROM "ProjectEntry" WHERE "projectId" = ${pid} AND ("id" = ${entry.id} OR starts_with("pathLower", ${`${entry.pathLower}/`}::text))`;
      await recount(tx, pid);
    });
    return reply.code(204).send();
  });

  app.get("/api/workspaces/:id/projects/:pid/history", async (req) => {
    const { id, pid } = ProjectParams.parse(req.params);
    await requireMember(req, id);
    await loadProject(id, pid);
    const entry = await loadEntry(pid, requirePath((req.query as { path?: string }).path));
    const rows = await prisma.fileRevision.findMany({ where: { entryId: entry.id }, orderBy: [{ revision: "desc" }, { createdAt: "desc" }] });
    const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true } });
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    return { revisions: rows.map((r) => ({ id: r.id, revision: r.revision, reason: r.reason, size: r.size, fromPath: r.fromPath, createdAt: r.createdAt, createdBy: nameOf.get(r.createdById) ?? "Someone" })) };
  });

  app.get("/api/workspaces/:id/projects/:pid/history/:revisionId", async (req) => {
    const { id, pid, revisionId } = ProjectParams.extend({ revisionId: z.string().min(1).max(64) }).parse(req.params);
    await requireMember(req, id);
    await loadProject(id, pid);
    const rev = await prisma.fileRevision.findFirst({ where: { id: revisionId, projectId: pid } });
    if (!rev) throw new HttpError(404, "not_found", "Version not found");
    const data = await getBlob(rev.blobHash);
    if (!isTextContent(data) || data.length > LIMITS.maxEditorBytes) throw new HttpError(415, "not_text", "This version can't be shown as text");
    return { content: data.toString("utf8"), revision: rev.revision };
  });

  app.post("/api/workspaces/:id/projects/:pid/restore", saveLimit, async (req) => {
    const { id, pid } = ProjectParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    await loadProject(id, pid);
    const body = Restore.parse(req.body);
    const entry = await loadEntry(pid, requirePath(body.path));
    const rev = await prisma.fileRevision.findFirst({ where: { id: body.revisionId, entryId: entry.id } });
    if (!rev) throw new HttpError(404, "not_found", "Version not found");
    const next = entry.revision + 1;
    const data = await getBlob(rev.blobHash);
    const restored = await prisma.$transaction(async (tx) => {
      const r = await tx.projectEntry.updateMany({ where: { id: entry.id, revision: entry.revision }, data: { blobHash: rev.blobHash, size: rev.size, isText: isTextContent(data), revision: next, updatedById: user.id } });
      if (r.count === 0) return false;
      await tx.fileRevision.create({ data: { entryId: entry.id, projectId: pid, blobHash: rev.blobHash, size: rev.size, revision: next, reason: "restore", createdById: user.id } });
      await recount(tx, pid);
      return true;
    });
    if (!restored) throw new HttpError(409, "conflict", "This file changed while restoring. Try again.");
    return { revision: next };
  });
}
