import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { audit, HttpError, requireMember } from "../http.js";
import { createsCycle } from "../org.js";
import { relayout } from "../templates.js";
import { Name, WsParams } from "./workspaces.js";

const AgentParams = WsParams.extend({ agentId: z.string().min(1).max(64) });

const Look = z.object({
  style: z.enum(["robot", "orb"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a #rrggbb color"),
  head: z.enum(["square", "round", "tall"]),
  eyes: z.enum(["dots", "visor", "wide"]),
  accessory: z.enum(["none", "antenna", "headset", "cap"]),
});

const Fields = {
  name: Name,
  role: Name,
  kind: z.enum(["ai", "human"]),
  workingStyle: z.string().trim().max(500),
  departmentId: z.string().max(64).nullable(),
  managerId: z.string().max(64).nullable(),
  appearance: Look,
};

const CreateAgent = z.object({
  ...Fields,
  kind: Fields.kind.default("ai"),
  workingStyle: Fields.workingStyle.default(""),
  departmentId: Fields.departmentId.default(null),
  managerId: Fields.managerId.default(null),
});

const UpdateAgent = z.object(Fields).partial().extend({ status: z.enum(["active", "paused", "archived"]).optional() });

/** Department and manager must exist in this workspace; managers must be active and not create a loop. */
async function checkRelations(workspaceId: string, agentId: string | null, departmentId?: string | null, managerId?: string | null) {
  if (departmentId) {
    const dept = await prisma.department.findFirst({ where: { id: departmentId, workspaceId } });
    if (!dept) throw new HttpError(400, "invalid", "That department isn't in this workspace");
  }
  if (managerId) {
    const all = await prisma.agent.findMany({ where: { workspaceId }, select: { id: true, managerId: true, status: true } });
    const manager = all.find((a) => a.id === managerId);
    if (!manager || manager.status !== "active") throw new HttpError(400, "invalid", "The manager must be an active companion in this workspace");
    if (agentId && createsCycle(agentId, managerId, new Map(all.map((a) => [a.id, a.managerId])))) {
      throw new HttpError(409, "cycle", "That would make a reporting loop");
    }
  }
}

export async function agentRoutes(app: FastifyInstance) {
  app.post("/api/workspaces/:id/agents", async (req, reply) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const { appearance, ...body } = CreateAgent.parse(req.body);
    await checkRelations(id, null, body.departmentId, body.managerId);
    const agent = await prisma.$transaction(async (tx) => {
      const created = await tx.agent.create({ data: { ...body, workspaceId: id, appearance: { create: appearance } } });
      await relayout(tx, id);
      await audit(tx, id, user.id, "agent.create", "agent", created.id, { name: created.name });
      return created;
    });
    return reply.code(201).send({ id: agent.id });
  });

  app.patch("/api/workspaces/:id/agents/:agentId", async (req) => {
    const { id, agentId } = AgentParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const { appearance, status, ...body } = UpdateAgent.parse(req.body);
    const agent = await prisma.agent.findFirst({ where: { id: agentId, workspaceId: id } });
    if (!agent) throw new HttpError(404, "not_found", "Companion not found");
    if (agent.isHead && status === "archived") throw new HttpError(400, "invalid", "The head agent can't be archived");
    if (agent.isHead && body.managerId) throw new HttpError(400, "invalid", "The head agent reports to you, not to another companion");
    if (agent.managerId !== body.managerId || agent.departmentId !== body.departmentId) {
      await checkRelations(id, agentId, body.departmentId, body.managerId);
    }
    const structural = (body.departmentId !== undefined && body.departmentId !== agent.departmentId) || (status !== undefined && status !== agent.status);
    const action = status && status !== agent.status ? { archived: "agent.archive", paused: "agent.pause", active: "agent.resume" }[status] : "agent.update";

    await prisma.$transaction(async (tx) => {
      await tx.agent.update({
        where: { id: agentId },
        data: {
          ...body,
          status,
          ...(appearance && { appearance: { upsert: { create: appearance, update: appearance } } }),
        },
      });
      if (status === "archived" && agent.status !== "archived") {
        // Reports move up to the archived companion's own manager, so nobody is left reporting to an inactive one.
        const newManager = body.managerId !== undefined ? body.managerId : agent.managerId;
        const moved = await tx.agent.updateMany({ where: { workspaceId: id, managerId: agentId }, data: { managerId: newManager } });
        if (moved.count) await audit(tx, id, user.id, "agent.reassign_reports", "agent", agentId, { to: newManager, count: moved.count });
      }
      if (structural) await relayout(tx, id);
      await audit(tx, id, user.id, action, "agent", agentId, { fields: Object.keys(req.body as object) });
    });
    return { id: agentId };
  });

  app.post("/api/workspaces/:id/agents/:agentId/clone", async (req, reply) => {
    const { id, agentId } = AgentParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const src = await prisma.agent.findFirst({ where: { id: agentId, workspaceId: id }, include: { appearance: true } });
    if (!src) throw new HttpError(404, "not_found", "Companion not found");
    const look = src.appearance ? { style: src.appearance.style, color: src.appearance.color, head: src.appearance.head, eyes: src.appearance.eyes, accessory: src.appearance.accessory } : undefined;
    const copy = await prisma.$transaction(async (tx) => {
      const created = await tx.agent.create({
        data: {
          workspaceId: id,
          name: `${src.name} copy`.slice(0, 60),
          role: src.role,
          kind: src.kind,
          workingStyle: src.workingStyle,
          departmentId: src.departmentId,
          // A copy of the head agent reports to the head agent.
          managerId: src.isHead ? src.id : src.managerId,
          ...(look && { appearance: { create: look } }),
        },
      });
      await relayout(tx, id);
      await audit(tx, id, user.id, "agent.clone", "agent", created.id, { from: src.id });
      return created;
    });
    return reply.code(201).send({ id: copy.id });
  });
}
