import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import type { ImportSource, Prisma } from "../generated/prisma/client.js";
import { LIMITS } from "../files/rules.js";
import { addFiles, loadProject, ProjectParams, type Incoming } from "../files/service.js";
import { readZip, ZipLimitError } from "../files/zip.js";
import { audit, HttpError, perUser, requireMember } from "../http.js";
import { Name, WsParams } from "./workspaces.js";

type Parsed = { fields: Record<string, string>; files: Incoming[]; zip: Buffer | null; tooBig: string[] };

async function parse(req: FastifyRequest): Promise<Parsed> {
  const out: Parsed = { fields: {}, files: [], zip: null, tooBig: [] };
  let total = 0;
  for await (const part of req.parts({ limits: { fileSize: LIMITS.maxTotalBytes, files: 100, fields: 10, fieldSize: 256 * 1024 } })) {
    if (part.type === "field") {
      out.fields[part.fieldname] = String(part.value);
      continue;
    }
    if (part.fieldname === "zip" && out.zip) throw new HttpError(400, "invalid", "Upload one ZIP file at a time");
    // Count bytes as they stream: a file part stops being kept past 10 MB, and the request stops past 50 MB.
    const cap = part.fieldname === "zip" ? LIMITS.maxTotalBytes : LIMITS.maxFileBytes;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of part.file as AsyncIterable<Buffer>) {
      size += chunk.length;
      total += chunk.length;
      if (total > LIMITS.maxTotalBytes) throw new HttpError(413, "too_large", "One upload can be up to 50 MB. Upload fewer files at a time.");
      if (size <= cap) chunks.push(chunk);
    }
    if (size > cap || part.file.truncated) {
      if (part.fieldname === "zip") throw new HttpError(413, "too_large", "ZIP files can be up to 50 MB");
      out.tooBig.push(part.fieldname);
    } else if (part.fieldname === "zip") out.zip = Buffer.concat(chunks);
    else out.files.push({ path: part.fieldname, data: Buffer.concat(chunks) });
  }
  return out;
}

const Source = z.enum(["folder", "zip", "files"]);

async function ingest(projectId: string, userId: string, parsed: Parsed) {
  let files = parsed.files;
  let dirs: string[] = [];
  try {
    dirs = parsed.fields.dirs ? z.array(z.string().max(1024)).max(LIMITS.maxEntries).parse(JSON.parse(parsed.fields.dirs)) : [];
  } catch {
    throw new HttpError(400, "invalid", "The folder list couldn't be read");
  }
  if (parsed.zip) {
    let entries;
    try {
      entries = readZip(parsed.zip);
    } catch (e) {
      throw new HttpError(400, "invalid", e instanceof ZipLimitError ? e.message : "That ZIP file couldn't be read");
    }
    files = entries.filter((e) => !e.isDir).map((e) => ({ path: e.path, data: e.data }));
    dirs = entries.filter((e) => e.isDir).map((e) => e.path);
  }
  const result = await addFiles(projectId, userId, files, dirs);
  return { added: result.added, skipped: [...parsed.tooBig.map((path) => ({ path, reason: "larger than 10 MB" })), ...result.skipped] };
}

async function recordImport(importId: string, added: number, skipped: { path: string; reason: string }[]) {
  const current = await prisma.projectImport.findUniqueOrThrow({ where: { id: importId } });
  const merged = [...(current.skipped as { path: string; reason: string }[]), ...skipped].slice(0, 5000);
  await prisma.projectImport.update({ where: { id: importId }, data: { added: current.added + added, skipped: merged as unknown as Prisma.InputJsonValue } });
}

export async function uploadRoutes(app: FastifyInstance) {
  await app.register(multipart, { throwFileSizeLimit: false });
  const limited = { config: { rateLimit: { max: 30, timeWindow: "1 minute", keyGenerator: perUser } } };

  app.post("/api/workspaces/:id/projects/upload", limited, async (req, reply) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const parsed = await parse(req);
    const name = Name.parse(parsed.fields.name ?? "");
    const source = Source.parse(parsed.fields.source ?? "files") as ImportSource;
    const project = await prisma.project.create({ data: { workspaceId: id, name, createdById: user.id } });
    const imp = await prisma.projectImport.create({ data: { projectId: project.id, source, createdNew: true, createdById: user.id } });
    try {
      const result = await ingest(project.id, user.id, parsed);
      await recordImport(imp.id, result.added, result.skipped);
      if (source === "zip") await prisma.projectImport.update({ where: { id: imp.id }, data: { status: "complete" } });
      await audit(prisma, id, user.id, "project.upload", "project", project.id, { source, added: result.added });
      return reply.code(201).send({ projectId: project.id, importId: imp.id, ...result });
    } catch (e) {
      // A brand-new project from a failed first batch is removed, not left half-made.
      await prisma.project.delete({ where: { id: project.id } }).catch(() => {});
      throw e;
    }
  });

  app.post("/api/workspaces/:id/projects/:pid/upload", limited, async (req) => {
    const { id, pid } = ProjectParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    await loadProject(id, pid);
    const parsed = await parse(req);
    const source = Source.parse(parsed.fields.source ?? "files") as ImportSource;
    let importId = parsed.fields.importId;
    if (importId) {
      const imp = await prisma.projectImport.findFirst({ where: { id: importId, projectId: pid, status: "running" } });
      if (!imp) throw new HttpError(400, "invalid", "That upload has already finished");
    } else {
      importId = (await prisma.projectImport.create({ data: { projectId: pid, source, createdById: user.id } })).id;
    }
    const result = await ingest(pid, user.id, parsed);
    await recordImport(importId, result.added, result.skipped);
    if (source === "zip") await prisma.projectImport.update({ where: { id: importId }, data: { status: "complete" } });
    return { projectId: pid, importId, ...result };
  });

  app.post("/api/workspaces/:id/projects/:pid/imports/:importId/finish", async (req) => {
    const { id, pid, importId } = ProjectParams.extend({ importId: z.string().min(1).max(64) }).parse(req.params);
    await requireMember(req, id, "member");
    const project = await loadProject(id, pid);
    const { status } = z.object({ status: z.enum(["complete", "cancelled", "failed"]) }).parse(req.body);
    const imp = await prisma.projectImport.findFirst({ where: { id: importId, projectId: pid } });
    if (!imp) throw new HttpError(404, "not_found", "Upload not found");
    await prisma.projectImport.update({ where: { id: importId }, data: { status } });
    const empty = (await prisma.projectEntry.count({ where: { projectId: pid } })) === 0;
    // A new project whose upload failed part way is removed rather than left half-made.
    if (imp.createdNew && (status === "failed" || (status === "cancelled" && empty))) {
      await prisma.project.delete({ where: { id: project.id } });
      return { deletedProject: true };
    }
    return { deletedProject: false };
  });
}
