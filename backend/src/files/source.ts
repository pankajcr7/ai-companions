import { prisma } from "../db.js";
import type { Project, ProjectEntry } from "../generated/prisma/client.js";
import { HttpError } from "../http.js";
import { desktopCall } from "./desktop.js";
import { normalizePath } from "./rules.js";
import { getBlob } from "./store.js";

// A project's files live in the database, or (deviceId set) in a folder on the creator's computer, reached through
// the desktop app. Everything that lists or reads project files comes through here; writes go through saveFile.

export type Entry = Pick<ProjectEntry, "path" | "pathLower" | "kind" | "size" | "isText" | "revision" | "blobHash" | "updatedAt">;
type DeviceEntry = { path: string; kind: "file" | "dir"; size: number; isText: boolean; hash: string | null; mtime: number };

/** A folder file's revision: from its content (the app uses the same rule), so it changes whenever the content does. */
export const revOf = (hash: string) => parseInt(hash.slice(0, 12), 16) + 1;

export const onDevice = (p: Pick<Project, "deviceId">) => !!p.deviceId;

/** For what a folder on the computer does better itself (uploading into it, zipping it). */
export function notOnDevice(p: Pick<Project, "deviceId">) {
  if (p.deviceId) throw new HttpError(400, "on_device", "Not available for a folder on your computer; use Finder or Explorer.");
}

/** A folder project's files are only reachable by the person whose computer holds them. */
export function deviceAccess(p: Pick<Project, "deviceId" | "createdById">, userId: string) {
  if (p.deviceId && p.createdById !== userId) throw new HttpError(403, "forbidden", "This project's folder is on another person's computer.");
}

export async function listEntries(project: Project): Promise<Entry[]> {
  if (!project.deviceId) return prisma.projectEntry.findMany({ where: { projectId: project.id }, orderBy: { path: "asc" } });
  const { entries } = (await desktopCall(project, "list", {})) as { entries: DeviceEntry[] };
  return entries
    .filter((e) => normalizePath(e.path).ok)
    .map((e) => ({ path: e.path, pathLower: e.path.toLowerCase(), kind: e.kind, size: e.size, isText: e.isText, revision: e.hash ? revOf(e.hash) : 0, blobHash: e.hash, updatedAt: new Date(e.mtime || Date.now()) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export async function findEntry(project: Project, path: string): Promise<Entry | null> {
  if (!project.deviceId) return prisma.projectEntry.findUnique({ where: { projectId_pathLower: { projectId: project.id, pathLower: path.toLowerCase() } } });
  return (await listEntries(project)).find((e) => e.pathLower === path.toLowerCase()) ?? null;
}

export async function readBytes(project: Project, e: { path: string; blobHash: string | null }): Promise<Buffer> {
  if (!project.deviceId) return getBlob(e.blobHash!);
  const { base64 } = (await desktopCall(project, "read", { path: e.path })) as { base64: string };
  return Buffer.from(base64, "base64");
}

export const readText = async (project: Project, e: { path: string; blobHash: string | null }) => (await readBytes(project, e)).toString("utf8");

/** Runs a folder operation (mkdir, move, remove, versions, version, restore) on the computer. */
export const onFolder = (project: Project, op: string, args: object) => desktopCall(project, op, args);
