import type { FastifyReply } from "fastify";
import { z } from "zod";
import { prisma, type Db } from "../db.js";
import type { Project, ProjectEntry } from "../generated/prisma/client.js";
import { HttpError } from "../http.js";
import { WsParams } from "../routes/workspaces.js";
import { normalizePath } from "./rules.js";

export const ProjectParams = WsParams.extend({ pid: z.string().min(1).max(64) });

export function requirePath(raw: unknown): string {
  const r = normalizePath(String(raw ?? ""));
  if (!r.ok) throw new HttpError(400, "invalid", `That path isn't allowed: ${r.reason}`);
  return r.path;
}

export async function loadProject(workspaceId: string, pid: string): Promise<Project> {
  const p = await prisma.project.findFirst({ where: { id: pid, workspaceId } });
  if (!p) throw new HttpError(404, "not_found", "Project not found");
  return p;
}

export async function loadEntry(projectId: string, path: string) {
  const e = await prisma.projectEntry.findUnique({ where: { projectId_pathLower: { projectId, pathLower: path.toLowerCase() } } });
  if (!e) throw new HttpError(404, "not_found", "File not found");
  return e;
}

export async function recount(db: Db, projectId: string) {
  const agg = await db.projectEntry.aggregate({ where: { projectId, kind: "file" }, _sum: { size: true }, _count: true });
  await db.project.update({ where: { id: projectId }, data: { fileCount: agg._count, totalBytes: agg._sum.size ?? 0 } });
}

export const entryDTO = (e: ProjectEntry) => ({ path: e.path, kind: e.kind, size: e.size, isText: e.isText, revision: e.revision, updatedAt: e.updatedAt });
export const projectDTO = (p: Project) => ({ id: p.id, name: p.name, fileCount: p.fileCount, totalBytes: p.totalBytes, updatedAt: p.updatedAt });

const INLINE: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

/** Never lets the browser render uploaded content as a page: images inline, everything else an attachment. */
export function sendFile(reply: FastifyReply, name: string, data: Buffer, forceAttachment = false) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const inline = !forceAttachment ? INLINE[ext] : undefined;
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return reply
    .header("content-type", inline ?? "application/octet-stream")
    .header("content-disposition", `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`)
    .header("x-content-type-options", "nosniff")
    .header("content-security-policy", "sandbox")
    .header("cache-control", "private, no-store")
    .send(data);
}
