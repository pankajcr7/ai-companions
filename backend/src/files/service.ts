import { randomUUID } from "node:crypto";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { prisma, type Db } from "../db.js";
import type { Project, ProjectEntry } from "../generated/prisma/client.js";
import { HttpError } from "../http.js";
import { WsParams } from "../routes/workspaces.js";
import { exclusionReason, LIMITS, normalizePath, parentDirs, PRIVATE_KEY } from "./rules.js";
import { isTextContent, putBlob } from "./store.js";

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

export type Incoming = { path: string; data: Buffer };
type Skip = { path: string; reason: string };

/**
 * Validates and stores a batch. Never overwrites: a path that exists in any letter case is skipped.
 * Parent folders are created automatically; empty folders come from `dirs`.
 */
export async function addFiles(projectId: string, userId: string, files: Incoming[], dirs: string[]) {
  const skipped: Skip[] = [];
  const existing = await prisma.projectEntry.findMany({ where: { projectId }, select: { pathLower: true, kind: true } });
  const taken = new Map(existing.map((e) => [e.pathLower, e.kind]));
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  let entries = existing.length;
  let total = project.totalBytes;

  const accepted: { id: string; path: string; data: Buffer; isText: boolean }[] = [];
  const acceptedLower = new Set<string>();
  const newDirs = new Map<string, string>(); // lower -> path
  const isFree = (lower: string) => !taken.has(lower) && !newDirs.has(lower);

  for (const f of files) {
    const n = normalizePath(f.path);
    if (!n.ok) {
      skipped.push({ path: f.path, reason: n.reason });
      continue;
    }
    const path = n.path;
    const lower = path.toLowerCase();
    const excluded = exclusionReason(path, "file");
    if (excluded) {
      skipped.push({ path, reason: excluded });
      continue;
    }
    if (f.data.length > LIMITS.maxFileBytes) {
      skipped.push({ path, reason: "larger than 10 MB" });
      continue;
    }
    const isText = isTextContent(f.data);
    if (isText && PRIVATE_KEY.test(f.data.toString("utf8"))) {
      skipped.push({ path, reason: "contains a private key" });
      continue;
    }
    if (taken.has(lower) || acceptedLower.has(lower) || newDirs.has(lower)) {
      skipped.push({ path, reason: "a file with the same name already exists" });
      continue;
    }
    const parents = parentDirs(path);
    if (parents.some((d) => taken.get(d.toLowerCase()) === "file" || acceptedLower.has(d.toLowerCase()))) {
      skipped.push({ path, reason: "a file is in the way of its folder" });
      continue;
    }
    const missing = parents.filter((d) => isFree(d.toLowerCase()));
    if (entries + 1 + missing.length > LIMITS.maxEntries) {
      skipped.push({ path, reason: "the project has reached 2,000 files and folders" });
      continue;
    }
    if (total + f.data.length > LIMITS.maxTotalBytes) {
      skipped.push({ path, reason: "the project has reached 50 MB" });
      continue;
    }
    for (const d of missing) newDirs.set(d.toLowerCase(), d);
    entries += 1 + missing.length;
    total += f.data.length;
    acceptedLower.add(lower);
    accepted.push({ id: randomUUID(), path, data: f.data, isText });
  }
  for (const raw of dirs) {
    const n = normalizePath(raw);
    if (!n.ok || exclusionReason(n.path, "dir")) continue;
    const chain = [...parentDirs(n.path), n.path];
    if (chain.some((d) => taken.get(d.toLowerCase()) === "file" || acceptedLower.has(d.toLowerCase()))) continue;
    const missing = chain.filter((d) => isFree(d.toLowerCase()));
    if (entries + missing.length > LIMITS.maxEntries) break;
    for (const d of missing) newDirs.set(d.toLowerCase(), d);
    entries += missing.length;
  }

  const hashes: string[] = [];
  for (const a of accepted) hashes.push(await putBlob(a.data));
  await prisma.$transaction(async (tx) => {
    if (newDirs.size) {
      await tx.projectEntry.createMany({
        data: [...newDirs.values()].map((path) => ({ projectId, path, pathLower: path.toLowerCase(), kind: "dir" as const, updatedById: userId })),
        skipDuplicates: true,
      });
    }
    if (accepted.length) {
      await tx.projectEntry.createMany({
        data: accepted.map((a, i) => ({ id: a.id, projectId, path: a.path, pathLower: a.path.toLowerCase(), kind: "file" as const, blobHash: hashes[i], size: a.data.length, isText: a.isText, revision: 1, updatedById: userId })),
      });
      await tx.fileRevision.createMany({
        data: accepted.map((a, i) => ({ entryId: a.id, projectId, blobHash: hashes[i], size: a.data.length, revision: 1, reason: "upload" as const, createdById: userId })),
      });
    }
    await recount(tx, projectId);
  });
  return { added: accepted.length, skipped };
}
