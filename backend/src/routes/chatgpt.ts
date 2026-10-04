import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { completeAuthorization, localLoginEnabled, OAuthError, startAuthorization, type ChatgptSecret } from "../chatgpt-oauth.js";
import { decryptSecret, encryptSecret } from "../crypto.js";
import { prisma } from "../db.js";
import { audit, HttpError, perUser, requireMember } from "../http.js";
import { WsParams } from "./workspaces.js";

const frontend = () => process.env.FRONTEND_URL ?? "http://localhost:3000";

export async function chatgptRoutes(app: FastifyInstance) {
  app.post("/api/workspaces/:id/connections/chatgpt/start", { config: { rateLimit: { max: 5, timeWindow: "1 minute", keyGenerator: perUser } } }, async (req) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    if (!localLoginEnabled()) {
      throw new HttpError(400, "unavailable", "ChatGPT sign-in works only on a local or self-hosted install. A hosted site needs OpenAI's approval first.");
    }
    const { connectionId } = z.object({ connectionId: z.string().max(64).optional() }).parse(req.body ?? {});
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id }, select: { slug: true } });
    let existing: ChatgptSecret | null = null;
    if (connectionId) {
      const conn = await prisma.providerConnection.findFirst({ where: { id: connectionId, workspaceId: id, kind: "chatgpt" } });
      if (!conn) throw new HttpError(404, "not_found", "Connection not found");
      existing = JSON.parse(decryptSecret(conn.secret!)) as ChatgptSecret;
    }
    const url = await startAuthorization({
      userId: user.id,
      workspaceId: id,
      slug: ws.slug,
      connectionId: connectionId ?? null,
      clientId: existing?.clientId ?? null,
      subject: existing?.subject ?? null,
      idTokenHint: existing?.idToken,
    });
    return { url };
  });

  // The browser lands here directly on 127.0.0.1 (OpenAI's loopback rule). Not logged: the URL carries the code.
  app.get("/auth/callback", { logLevel: "silent" }, async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    try {
      const { pending, secret } = await completeAuthorization(query);
      const data = { secret: encryptSecret(JSON.stringify(secret)), hint: secret.email, status: "connected" as const, lastCheckedAt: new Date(), lastError: null };
      if (pending.connectionId) {
        await prisma.providerConnection.update({ where: { id: pending.connectionId }, data });
      } else {
        const conn = await prisma.providerConnection.create({ data: { ...data, workspaceId: pending.workspaceId, kind: "chatgpt", label: "ChatGPT", createdById: pending.userId } });
        await audit(prisma, pending.workspaceId, pending.userId, "connection.create", "connection", conn.id, { kind: "chatgpt" });
      }
      return reply.redirect(`${frontend()}/w/${pending.slug}/settings?tab=ai&connected=chatgpt`);
    } catch (e) {
      const message = e instanceof OAuthError ? e.message : "ChatGPT sign-in failed. Try again.";
      const p = e instanceof OAuthError ? e.pending : undefined;
      const target = p ? `/w/${p.slug}/settings?tab=ai&` : "/app?";
      return reply.redirect(`${frontend()}${target}chatgpt_error=${encodeURIComponent(message)}`);
    }
  });
}
