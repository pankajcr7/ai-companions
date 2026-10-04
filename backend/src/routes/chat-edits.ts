import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { loadProject, saveText } from "../files/service.js";
import { loadText } from "../goals/load.js";
import type { Write } from "../harness/tools.js";
import { audit, HttpError, requireMember } from "../http.js";
import { WsParams } from "./workspaces.js";

const EditParams = WsParams.extend({ eid: z.string().min(1).max(64) });

/** Collects a chat reply's writes; they are saved as suggestions once the reply's message exists. */
export function chatWriter() {
  const edits: Write[] = [];
  return { edits, write: async (w: Write) => (edits.push(w), "Saved as a suggestion for the owner to review.") };
}

export async function saveChatEdits(workspaceId: string, messageId: string, projectId: string | null, edits: Write[]) {
  if (!projectId || !edits.length) return;
  await prisma.chatEdit.createMany({ data: edits.map((e) => ({ workspaceId, messageId, projectId, path: e.path, baseRevision: e.baseRevision, content: e.content, note: e.note })) });
}

export const chatEditDTO = (e: { id: string; path: string; baseRevision: number; note: string; status: string; reason: string | null }) => ({ id: e.id, path: e.path, baseRevision: e.baseRevision, note: e.note, status: e.status, reason: e.reason });

async function loadEdit(workspaceId: string, userId: string, eid: string) {
  const edit = await prisma.chatEdit.findFirst({ where: { id: eid, workspaceId, message: { userId } } });
  if (!edit) throw new HttpError(404, "not_found", "Suggested change not found");
  return edit;
}

export async function chatEditRoutes(app: FastifyInstance) {
  app.get("/api/workspaces/:id/chat-edits/:eid", async (req) => {
    const { id, eid } = EditParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const edit = await loadEdit(id, user.id, eid);
    const entry = await prisma.projectEntry.findFirst({ where: { projectId: edit.projectId, pathLower: edit.path.toLowerCase(), kind: "file" } });
    const current = entry?.blobHash && entry.isText ? await loadText(entry.blobHash) : null;
    return { edit: { id: edit.id, path: edit.path, content: edit.content, current, status: edit.status } };
  });

  app.post("/api/workspaces/:id/chat-edits/:eid/apply", async (req) => {
    const { id, eid } = EditParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const edit = await loadEdit(id, user.id, eid);
    const project = await loadProject(id, edit.projectId);
    // The row stays locked while saving, so a second Apply waits and then sees the decision.
    const outcome = await prisma.$transaction(
      async (tx) => {
        const [row] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM "ChatEdit" WHERE id = ${eid} FOR UPDATE`;
        if (row?.status !== "pending") return { kind: "decided" as const };
        try {
          const saved = await saveText(project, user.id, edit.path, edit.content, edit.baseRevision);
          await tx.chatEdit.update({ where: { id: eid }, data: { status: "applied", decidedById: user.id } });
          return { kind: "applied" as const, saved };
        } catch (e) {
          if (!(e instanceof HttpError) || e.status !== 409) throw e;
          await tx.chatEdit.update({ where: { id: eid }, data: { status: "stale", reason: "The file changed after the companion read it.", decidedById: user.id } });
          return { kind: "stale" as const };
        }
      },
      { timeout: 60_000 },
    );
    if (outcome.kind === "decided") throw new HttpError(409, "conflict", "This change was already decided.");
    if (outcome.kind === "stale") throw new HttpError(409, "stale", "The file changed after the companion read it, so this change is out of date.");
    await audit(prisma, id, user.id, "chat.edit.apply", "chatEdit", eid, { path: edit.path });
    return outcome.saved;
  });

  app.post("/api/workspaces/:id/chat-edits/:eid/skip", async (req) => {
    const { id, eid } = EditParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    await loadEdit(id, user.id, eid);
    const r = await prisma.chatEdit.updateMany({ where: { id: eid, status: "pending" }, data: { status: "rejected", decidedById: user.id } });
    if (!r.count) throw new HttpError(409, "conflict", "This change was already decided.");
    return { ok: true };
  });
}
