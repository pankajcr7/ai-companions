import { prisma } from "../db.js";
import { addFiles } from "../files/service.js";
import { getBlob, putBlob } from "../files/store.js";
import type { Attachment, Project } from "../generated/prisma/client.js";
import type { ImageSource, MediaStore } from "../harness/images.js";
import { ToolError } from "../harness/loop.js";
import { HttpError } from "../http.js";
import { detect } from "./detect.js";

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

/** Uploads never sent with a message, and images never linked to a reply or task, are removed after a day. */
export async function cleanupAttachments(now = Date.now()): Promise<number> {
  const r = await prisma.attachment.deleteMany({ where: { messageId: null, goalMessageId: null, goalId: null, taskId: null, createdAt: { lt: new Date(now - DAY_MS) } } });
  return r.count;
}

/** A work request's files go to the goal: the request message's own files, plus earlier ones in the chat that the goal names. */
export async function linkGoalAttachments(goalId: string, userMessageId: string, conversationId: string, goalText: string) {
  await prisma.attachment.updateMany({ where: { messageId: userMessageId }, data: { goalId } });
  const earlier = await prisma.attachment.findMany({ where: { goalId: null, message: { conversationId } }, select: { id: true, name: true } });
  const named = earlier.filter((a) => goalText.toLowerCase().includes(a.name.toLowerCase())).map((a) => a.id);
  if (named.length) await prisma.attachment.updateMany({ where: { id: { in: named } }, data: { goalId } });
}

/** On Start: the goal's files are copied into the project's attachments/ folder and listed with the first task. */
export async function copyGoalAttachments(workspaceId: string, goalId: string, userId: string, projectId: string) {
  const atts = await prisma.attachment.findMany({ where: { goalId }, orderBy: { createdAt: "asc" } });
  if (!atts.length) return;
  const project = await prisma.project.findFirstOrThrow({ where: { id: projectId, workspaceId } });
  const first = await prisma.goalTask.findFirst({ where: { goalId }, orderBy: { position: "asc" } });
  const problems: string[] = [];
  for (const att of atts) {
    try {
      const path = await copyIntoProject(att, project, userId);
      if (first) await prisma.proposedEdit.create({ data: { taskId: first.id, goalId, path, baseRevision: 0, content: "", note: "Your attachment", status: "applied", decidedById: userId } });
    } catch (e) {
      problems.push(e instanceof HttpError ? e.message : `${att.name} couldn't be added`);
    }
  }
  if (problems.length) await prisma.goal.update({ where: { id: goalId }, data: { error: problems.join(" ") } });
}

/**
 * Images companions make while replying or working. Each is stored like an upload, so thumbnails and Save to project work.
 * A chat image is linked to the reply once it's saved (`link`); a task image is linked to the task right away,
 * and in a project it's also copied to images/ and listed with the goal's changes.
 * `source` finds images to edit by name: images made here, the given files, then the project's files.
 */
export function madeImages(o: { workspaceId: string; userId: string; files: Attachment[]; project: Project | null; task?: { id: string; goalId: string } }) {
  const made: Attachment[] = [];
  const media: MediaStore = {
    async save(data, fileName) {
      const mime = detect(fileName, data)?.mime ?? "image/png";
      const row = await prisma.attachment.create({ data: { workspaceId: o.workspaceId, userId: o.userId, name: fileName, mime, kind: "image", size: data.length, blobHash: await putBlob(data), taskId: o.task?.id ?? null } });
      made.push(row);
      if (!o.task) return `Shown to the owner under your reply as ${fileName}`;
      if (!o.project) return `Shown to the owner on the task card as ${fileName}`;
      const path = await freePath(o.project.id, "images", fileName);
      const result = await addFiles(o.project.id, o.userId, [{ path, data }], []);
      if (!result.added) return `Shown to the owner on the task card as ${fileName}; it couldn't be added to the project (${result.skipped[0]?.reason ?? "the project is full"})`;
      await prisma.proposedEdit.create({ data: { taskId: o.task.id, goalId: o.task.goalId, path, baseRevision: 0, content: "", note: "Image", status: "applied", decidedById: o.userId } });
      return `Saved as ${path}`;
    },
  };
  const source: ImageSource = async (name) => {
    const want = name.trim().toLowerCase();
    const att = [...made, ...o.files].find((a) => a.name.toLowerCase() === want);
    let data = att ? await getBlob(att.blobHash) : null;
    if (!data && o.project) {
      const entry = await prisma.projectEntry.findFirst({ where: { projectId: o.project.id, pathLower: want, kind: "file" } });
      if (entry?.blobHash) data = await getBlob(entry.blobHash);
    }
    if (!data) throw new ToolError(`There's no image called ${name}. Use list_attachments or list_files to see them.`);
    if (detect(name, data)?.kind !== "image") throw new ToolError(`${name} isn't an image.`);
    return data;
  };
  const link = async (to: { messageId: string } | { goalMessageId: string }) => {
    if (made.length) await prisma.attachment.updateMany({ where: { id: { in: made.map((m) => m.id) } }, data: to });
  };
  return { media, source, link };
}
