import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { audit, HttpError, requireMember, requireUser } from "../http.js";
import type { Layout } from "../layout.js";
import { relayout } from "../templates.js";
import type { Prisma } from "../generated/prisma/client.js";
import { snapshot } from "../snapshot.js";
import { createWorkspaceFromTemplate } from "../templates.js";

export const WsParams = z.object({ id: z.string().min(1).max(64) });
export const Name = z.string().trim().min(1).max(60);

const CreateWorkspace = z.object({ name: Name, template: z.enum(["starter", "studio", "head-only"]) });
const DeptParams = WsParams.extend({ deptId: z.string().min(1).max(64) });
const Point = z.object({ x: z.number().finite(), y: z.number().finite() });
const LayoutBody = z.object({
  // Zones are server-owned (relayout computes them); accepted for compatibility but ignored.
  zones: z.array(Point.extend({ departmentId: z.string().max(64), w: z.number().positive(), h: z.number().positive() })).max(200).optional(),
  desks: z.record(z.string().max(64), Point).refine((d) => Object.keys(d).length <= 1000, "too many desks"),
});
const Preferences = z.object({ theme: z.enum(["system", "light", "dark"]), reducedMotion: z.boolean(), calmMode: z.boolean() });

export async function workspaceRoutes(app: FastifyInstance) {
  app.post("/api/workspaces", async (req, reply) => {
    const user = await requireUser(req);
    const body = CreateWorkspace.parse(req.body);
    return reply.code(201).send(await createWorkspaceFromTemplate(user.id, body.name, body.template));
  });

  app.get("/api/workspaces/:id", async (req) => {
    const { id } = WsParams.parse(req.params);
    const { user, role } = await requireMember(req, id);
    return snapshot(id, user.id, role);
  });
  app.patch("/api/workspaces/:id", async (req) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    const { name } = z.object({ name: Name }).parse(req.body);
    await prisma.workspace.update({ where: { id }, data: { name } });
    await audit(prisma, id, user.id, "workspace.rename", "workspace", id, { name });
    return { ok: true };
  });

  app.post("/api/workspaces/:id/departments", async (req, reply) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    const { name } = z.object({ name: Name }).parse(req.body);
    const dept = await prisma.$transaction(async (tx) => {
      const last = await tx.department.findFirst({ where: { workspaceId: id }, orderBy: { sortOrder: "desc" } });
      const created = await tx.department.create({ data: { workspaceId: id, name, sortOrder: (last?.sortOrder ?? -1) + 1 } });
      await relayout(tx, id);
      await audit(tx, id, user.id, "department.create", "department", created.id, { name });
      return created;
    });
    return reply.code(201).send({ id: dept.id });
  });

  app.patch("/api/workspaces/:id/departments/:deptId", async (req) => {
    const { id, deptId } = DeptParams.parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    const body = z.object({ name: Name.optional(), sortOrder: z.number().int().min(-1000).max(1000).optional() }).parse(req.body);
    if (!(await prisma.department.findFirst({ where: { id: deptId, workspaceId: id } }))) throw new HttpError(404, "not_found", "Department not found");
    await prisma.$transaction(async (tx) => {
      await tx.department.update({ where: { id: deptId }, data: body });
      if (body.sortOrder !== undefined) await relayout(tx, id);
      await audit(tx, id, user.id, "department.update", "department", deptId, body);
    });
    return { ok: true };
  });

  app.delete("/api/workspaces/:id/departments/:deptId", async (req, reply) => {
    const { id, deptId } = DeptParams.parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    if (!(await prisma.department.findFirst({ where: { id: deptId, workspaceId: id } }))) throw new HttpError(404, "not_found", "Department not found");
    await prisma.$transaction(async (tx) => {
      // Agents are kept: the foreign key sets their departmentId to null.
      await tx.department.delete({ where: { id: deptId } });
      await relayout(tx, id);
      await audit(tx, id, user.id, "department.delete", "department", deptId);
    });
    return reply.code(204).send();
  });

  app.put("/api/workspaces/:id/layout", async (req) => {
    const { id } = WsParams.parse(req.params);
    await requireMember(req, id, "member");
    const body = LayoutBody.parse(req.body);
    const agentIds = new Set((await prisma.agent.findMany({ where: { workspaceId: id }, select: { id: true } })).map((a) => a.id));
    const stored = ((await prisma.officeLayout.findUnique({ where: { workspaceId: id } }))?.layout as Layout | undefined) ?? { zones: [], desks: {} };
    // Merge only desk positions into the stored layout, so a stale client can't erase newer zones or desks.
    // ponytail: read-merge-write, two simultaneous drags can lose one; use a JSON update in SQL if that bites.
    const layout = {
      zones: stored.zones,
      desks: { ...stored.desks, ...Object.fromEntries(Object.entries(body.desks).filter(([agentId]) => agentIds.has(agentId))) },
    } as unknown as Prisma.InputJsonValue;
    await prisma.officeLayout.upsert({ where: { workspaceId: id }, create: { workspaceId: id, layout }, update: { layout } });
    return { ok: true };
  });

  app.put("/api/workspaces/:id/preferences", async (req) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id);
    const prefs = Preferences.parse(req.body);
    await prisma.userPreference.upsert({
      where: { userId_workspaceId: { userId: user.id, workspaceId: id } },
      create: { userId: user.id, workspaceId: id, ...prefs },
      update: prefs,
    });
    return { ok: true };
  });
}
