import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { encryptSecret } from "../crypto.js";
import { prisma } from "../db.js";
import { checkCloudflare, checkPollinations } from "../harness/images.js";
import { ToolError } from "../harness/loop.js";
import { audit, HttpError, requireMember } from "../http.js";
import { hint } from "./search-key.js";
import { WsParams } from "./workspaces.js";

const Provider = z.enum(["cloudflare", "pollinations"]);
const Cloudflare = z.object({ accountId: z.string().trim().regex(/^[a-f0-9]{32}$/i, "An Account ID is 32 letters and digits"), apiToken: z.string().trim().min(20).max(200) });
const Pollinations = z.object({ apiKey: z.string().trim().regex(/^sk_[A-Za-z0-9_-]{8,200}$/, "Use a Pollinations secret key (it starts with sk_)") });

/** The key check's plain message becomes a 400 for the Settings form. */
async function checked(check: () => Promise<void>) {
  try {
    await check();
  } catch (e) {
    if (e instanceof ToolError) throw new HttpError(400, "invalid", e.message);
    throw e;
  }
}

async function saveKey(workspaceId: string, userId: string, provider: z.infer<typeof Provider>, secret: string, shown: string) {
  const data = { secret: encryptSecret(secret), hint: hint(shown), createdById: userId };
  await prisma.imageKey.upsert({ where: { workspaceId_provider: { workspaceId, provider } }, create: { workspaceId, provider, ...data }, update: data });
  await audit(prisma, workspaceId, userId, "image_key.set", "workspace", workspaceId);
  return { hint: data.hint };
}

export async function imageKeyRoutes(app: FastifyInstance) {
  app.get("/api/workspaces/:id/image-keys", async (req) => {
    const { id } = WsParams.parse(req.params);
    await requireMember(req, id);
    const rows = await prisma.imageKey.findMany({ where: { workspaceId: id } });
    const of = (provider: string) => {
      const row = rows.find((r) => r.provider === provider);
      return row ? { hint: row.hint } : null;
    };
    return { cloudflare: of("cloudflare"), pollinations: of("pollinations") };
  });

  app.put("/api/workspaces/:id/image-keys/cloudflare", async (req) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    const key = Cloudflare.parse(req.body);
    await checked(() => checkCloudflare(key, AbortSignal.timeout(15_000)));
    return saveKey(id, user.id, "cloudflare", JSON.stringify(key), key.apiToken);
  });

  app.put("/api/workspaces/:id/image-keys/pollinations", async (req) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    const { apiKey } = Pollinations.parse(req.body);
    await checked(() => checkPollinations(apiKey, AbortSignal.timeout(15_000)));
    return saveKey(id, user.id, "pollinations", apiKey, apiKey);
  });

  app.delete("/api/workspaces/:id/image-keys/:provider", async (req, reply) => {
    const { id, provider } = WsParams.extend({ provider: Provider }).parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    await prisma.imageKey.deleteMany({ where: { workspaceId: id, provider } });
    await audit(prisma, id, user.id, "image_key.delete", "workspace", id);
    return reply.code(204).send();
  });
}
