import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { detect } from "../attachments/detect.js";
import { extractText } from "../attachments/extract.js";
import { attachmentDTO, copyIntoProject } from "../attachments/service.js";
import { prisma } from "../db.js";
import { LIMITS } from "../files/rules.js";
import { loadProject, sendFile } from "../files/service.js";
import { getBlob, putBlob } from "../files/store.js";
import { HttpError, perUser, requireMember } from "../http.js";
import { WsParams } from "./workspaces.js";

const Params = WsParams.extend({ aid: z.string().min(1).max(64) });
/** Keeps only the file's own name: no folders, no control characters. */
const cleanName = (raw: string) => (raw.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200) || "file";

async function mine(req: FastifyRequest, min: "viewer" | "member" = "viewer") {
  const { id, aid } = Params.parse(req.params);
  const { user } = await requireMember(req, id, min);
  const att = await prisma.attachment.findFirst({ where: { id: aid, workspaceId: id, userId: user.id } });
  if (!att) throw new HttpError(404, "not_found", "Attachment not found");
  return { id, user, att };
}

export async function attachmentRoutes(app: FastifyInstance) {
  await app.register(multipart, { throwFileSizeLimit: false });

  app.post("/api/workspaces/:id/attachments", { config: { rateLimit: { max: 60, timeWindow: "1 minute", keyGenerator: perUser } } }, async (req) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    let file: { name: string; data: Buffer } | null = null;
    let view: Buffer | null = null;
    for await (const part of req.parts({ limits: { fileSize: LIMITS.maxFileBytes + 1, files: 2, fields: 0 } })) {
      if (part.type !== "file") continue;
      const name = cleanName(part.filename || "file");
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of part.file as AsyncIterable<Buffer>) {
        size += chunk.length;
        if (size <= LIMITS.maxFileBytes) chunks.push(chunk);
      }
      if (size > LIMITS.maxFileBytes || part.file.truncated) throw new HttpError(413, "too_large", `${name} is over 10 MB`);
      if (part.fieldname === "file") file = { name, data: Buffer.concat(chunks) };
      else if (part.fieldname === "view") view = Buffer.concat(chunks);
    }
    if (!file) throw new HttpError(400, "invalid", "No file was sent");
    const type = detect(file.name, file.data);
    if (!type) throw new HttpError(415, "unsupported", "This file type isn't supported yet");
    // The browser's smaller copy of a big photo is only kept if it really is an image.
    const viewType = view && type.kind === "image" ? detect("view", view) : null;
    const keepView = viewType?.kind === "image";
    const [blobHash, viewHash] = await Promise.all([putBlob(file.data), keepView ? putBlob(view!) : Promise.resolve(null)]);
    const text = await extractText(type.kind, type.mime, file.data);
    const row = await prisma.attachment.create({
      data: { workspaceId: id, userId: user.id, name: file.name, mime: type.mime, kind: type.kind, size: file.data.length, blobHash, viewHash, viewMime: keepView ? viewType!.mime : null, text: text.text, pages: text.pages, scanned: text.scanned },
    });
    return attachmentDTO(row);
  });

  app.get("/api/workspaces/:id/attachments/:aid", async (req) => attachmentDTO((await mine(req)).att));

  // Text files (SVG included) always download; images and PDFs may open in the browser.
  app.get("/api/workspaces/:id/attachments/:aid/content", async (req, reply) => {
    const { att } = await mine(req);
    return sendFile(reply, att.name, await getBlob(att.blobHash), att.kind === "text" || att.kind === "office");
  });

  app.get("/api/workspaces/:id/attachments/:aid/view", async (req, reply) => {
    const { att } = await mine(req);
    if (att.kind !== "image") throw new HttpError(404, "not_found", "Only images have a view");
    return reply
      .header("content-type", att.viewMime ?? att.mime)
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "private, max-age=3600")
      .send(await getBlob(att.viewHash ?? att.blobHash));
  });

  app.post("/api/workspaces/:id/attachments/:aid/save", async (req) => {
    const { id, user, att } = await mine(req, "member");
    const { projectId } = z.object({ projectId: z.string().min(1).max(64) }).parse(req.body);
    return { path: await copyIntoProject(att, await loadProject(id, projectId), user.id) };
  });
}
