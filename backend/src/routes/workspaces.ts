import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireMember, requireUser } from "../http.js";
import { snapshot } from "../snapshot.js";
import { createWorkspaceFromTemplate } from "../templates.js";

export const WsParams = z.object({ id: z.string().min(1).max(64) });
export const Name = z.string().trim().min(1).max(60);

const CreateWorkspace = z.object({ name: Name, template: z.enum(["starter", "studio", "head-only"]) });

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
}
