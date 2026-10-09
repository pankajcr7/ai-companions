import { prisma } from "../db.js";
import { addFiles } from "../files/service.js";
import { getBlob } from "../files/store.js";
import type { Attachment, Project } from "../generated/prisma/client.js";
import { HttpError } from "../http.js";

export const MAX_ATTACHMENTS = 10;
const DAY_MS = 24 * 3600_000;

export const attachmentDTO = (a: Attachment) => ({
  id: a.id,
  name: a.name,
  kind: a.kind,
  mime: a.mime,
  size: a.size,
  pages: a.pages,
  scanned: a.scanned,
  url: `/api/workspaces/${a.workspaceId}/attachments/${a.id}/content`,
  viewUrl: `/api/workspaces/${a.workspaceId}/attachments/${a.id}/view`,
});

/** The caller's own not-yet-sent attachments, in the order asked; anyone else's (or an already sent) id is "not found". */
export async function ownAttachments(workspaceId: string, userId: string, ids: string[]): Promise<Attachment[]> {
  if (!ids.length) return [];
  if (ids.length > MAX_ATTACHMENTS) throw new HttpError(400, "invalid", `Up to ${MAX_ATTACHMENTS} files per message`);
  const rows = await prisma.attachment.findMany({ where: { id: { in: ids }, workspaceId, userId, messageId: null, goalMessageId: null } });
  if (rows.length !== new Set(ids).size) throw new HttpError(404, "not_found", "Attachment not found");
  return ids.map((id) => rows.find((r) => r.id === id)!);
}

/** "attachments/logo.png", or "attachments/logo (2).png" when that name is taken. */
async function freePath(projectId: string, folder: string, name: string) {
  const taken = new Set((await prisma.projectEntry.findMany({ where: { projectId, pathLower: { startsWith: `${folder.toLowerCase()}/` } }, select: { pathLower: true } })).map((e) => e.pathLower));
  const dot = name.lastIndexOf(".");
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let n = 1; ; n++) {
    const path = `${folder}/${n === 1 ? name : `${base} (${n})${ext}`}`;
    if (!taken.has(path.toLowerCase())) return path;
  }
}

/** Copies the original file into a project; never overwrites. Returns where it was saved. */
export async function copyIntoProject(att: Attachment, project: Project, userId: string): Promise<string> {
  const path = await freePath(project.id, "attachments", att.name);
  const result = await addFiles(project.id, userId, [{ path, data: await getBlob(att.blobHash) }], []);
  if (!result.added) throw new HttpError(413, "too_large", `${att.name} couldn't be added: ${result.skipped[0]?.reason ?? "the project is full"}`);
  return path;
}

/** Uploads that were never sent with a message are removed after a day. */
export async function cleanupAttachments(now = Date.now()): Promise<number> {
  const r = await prisma.attachment.deleteMany({ where: { messageId: null, goalMessageId: null, goalId: null, createdAt: { lt: new Date(now - DAY_MS) } } });
  return r.count;
}
