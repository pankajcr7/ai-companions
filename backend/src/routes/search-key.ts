import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { encryptSecret } from "../crypto.js";
import { prisma } from "../db.js";
import { ToolError } from "../harness/loop.js";
import { tavilySearch } from "../harness/web.js";
import { audit, HttpError, requireMember } from "../http.js";
import { WsParams } from "./workspaces.js";

const hint = (k: string) => (k.length >= 10 ? `${k.slice(0, 3)}…${k.slice(-4)}` : `…${k.slice(-2)}`);

export async function searchKeyRoutes(app: FastifyInstance) {
  app.get("/api/workspaces/:id/search-key", async (req) => {
    const { id } = WsParams.parse(req.params);
    await requireMember(req, id);
    const row = await prisma.searchKey.findUnique({ where: { workspaceId: id } });
    return { key: row ? { provider: row.provider, hint: row.hint } : null };
  });

  app.put("/api/workspaces/:id/search-key", async (req) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    const { apiKey } = z.object({ apiKey: z.string().trim().min(8).max(200) }).parse(req.body);
    try {
      await tavilySearch(apiKey, "test", AbortSignal.timeout(15_000));
    } catch (e) {
      if (e instanceof ToolError) throw new HttpError(400, "invalid", e.message.replace(" Update it in Settings › AI services.", ""));
      throw e;
    }
    const data = { provider: "tavily", secret: encryptSecret(apiKey), hint: hint(apiKey), createdById: user.id };
    await prisma.searchKey.upsert({ where: { workspaceId: id }, create: { workspaceId: id, ...data }, update: data });
    await audit(prisma, id, user.id, "search_key.set", "workspace", id);
    return { provider: data.provider, hint: data.hint };
  });

  app.delete("/api/workspaces/:id/search-key", async (req, reply) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    await prisma.searchKey.deleteMany({ where: { workspaceId: id } });
    await audit(prisma, id, user.id, "search_key.delete", "workspace", id);
    return reply.code(204).send();
  });
}
