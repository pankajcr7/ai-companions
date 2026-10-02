import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { encryptSecret, SecretError } from "../crypto.js";
import { prisma } from "../db.js";
import type { ProviderConnection } from "../generated/prisma/client.js";
import { audit, HttpError, requireMember } from "../http.js";
import { clientFor } from "../providers/index.js";
import { ProviderError } from "../providers/types.js";
import { checkBaseUrl, UnsafeUrlError } from "../safe-fetch.js";
import { Name, WsParams } from "./workspaces.js";

const ConnParams = WsParams.extend({ cid: z.string().min(1).max(64) });
const ApiKey = z.string().trim().min(1).max(500);
const CreateConnection = z
  .object({ kind: z.enum(["openai", "anthropic", "gemini", "custom"]), label: Name, apiKey: ApiKey.optional(), baseUrl: z.string().trim().min(1).max(500).optional() })
  .superRefine((v, ctx) => {
    if (v.kind !== "custom" && !v.apiKey) ctx.addIssue({ code: "custom", path: ["apiKey"], message: "An API key is required" });
    if (v.kind === "custom" && !v.baseUrl) ctx.addIssue({ code: "custom", path: ["baseUrl"], message: "A base URL is required" });
  });
const UpdateConnection = z.object({ label: Name.optional(), apiKey: ApiKey.optional() });

const keyHint = (k: string) => (k.length >= 10 ? `${k.slice(0, 3)}…${k.slice(-4)}` : `…${k.slice(-2)}`);
const plainMessage = (e: unknown) =>
  e instanceof ProviderError || e instanceof UnsafeUrlError || e instanceof SecretError ? e.message : "Couldn't check this connection.";

export function connectionDTO(c: ProviderConnection, totals?: { inputTokens: number; outputTokens: number }) {
  return {
    id: c.id,
    kind: c.kind,
    label: c.label,
    baseUrl: c.baseUrl,
    hint: c.hint,
    status: c.status,
    lastCheckedAt: c.lastCheckedAt,
    lastError: c.lastError,
    inputTokens: totals?.inputTokens ?? 0,
    outputTokens: totals?.outputTokens ?? 0,
  };
}

async function probe(conn: Parameters<typeof clientFor>[0]) {
  try {
    return { ok: true as const, models: (await clientFor(conn).listModels(AbortSignal.timeout(20_000))).length };
  } catch (e) {
    return { ok: false as const, error: e };
  }
}

async function loadConnection(workspaceId: string, cid: string) {
  const c = await prisma.providerConnection.findFirst({ where: { id: cid, workspaceId } });
  if (!c) throw new HttpError(404, "not_found", "Connection not found");
  return c;
}

export async function connectionRoutes(app: FastifyInstance) {
  app.get("/api/workspaces/:id/connections", async (req) => {
    const { id } = WsParams.parse(req.params);
    await requireMember(req, id);
    const [rows, sums] = await Promise.all([
      prisma.providerConnection.findMany({ where: { workspaceId: id }, orderBy: { createdAt: "asc" } }),
      prisma.chatMessage.groupBy({ by: ["connectionId"], where: { workspaceId: id }, _sum: { inputTokens: true, outputTokens: true } }),
    ]);
    const totals = new Map(sums.map((s) => [s.connectionId, { inputTokens: s._sum.inputTokens ?? 0, outputTokens: s._sum.outputTokens ?? 0 }]));
    return { connections: rows.map((c) => connectionDTO(c, totals.get(c.id))), chatgptLocalLogin: process.env.CHATGPT_LOCAL_LOGIN === "true" };
  });

  app.post("/api/workspaces/:id/connections", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    const body = CreateConnection.parse(req.body);
    let baseUrl: string | null = null;
    try {
      baseUrl = body.kind === "custom" ? checkBaseUrl(body.baseUrl!) : null;
    } catch (e) {
      throw new HttpError(400, "invalid", plainMessage(e));
    }
    const secret = body.apiKey ? encryptSecret(body.apiKey) : null;
    const result = await probe({ id: "new", kind: body.kind, baseUrl, secret });
    if (!result.ok) throw new HttpError(400, "connection_failed", plainMessage(result.error));
    const created = await prisma.providerConnection.create({
      data: {
        workspaceId: id,
        kind: body.kind,
        label: body.label,
        baseUrl,
        secret,
        hint: body.apiKey ? keyHint(body.apiKey) : new URL(baseUrl!).host,
        status: "connected",
        lastCheckedAt: new Date(),
        createdById: user.id,
      },
    });
    await audit(prisma, id, user.id, "connection.create", "connection", created.id, { kind: body.kind });
    return reply.code(201).send({ id: created.id });
  });

  app.patch("/api/workspaces/:id/connections/:cid", async (req) => {
    const { id, cid } = ConnParams.parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    const body = UpdateConnection.parse(req.body);
    const conn = await loadConnection(id, cid);
    const data: { label?: string; secret?: string; hint?: string; status?: "connected"; lastCheckedAt?: Date; lastError?: null } = {};
    if (body.label) data.label = body.label;
    if (body.apiKey) {
      if (conn.kind === "chatgpt") throw new HttpError(400, "invalid", "ChatGPT connections use sign-in, not a key");
      const secret = encryptSecret(body.apiKey);
      const result = await probe({ ...conn, secret });
      if (!result.ok) throw new HttpError(400, "connection_failed", plainMessage(result.error));
      Object.assign(data, { secret, hint: keyHint(body.apiKey), status: "connected", lastCheckedAt: new Date(), lastError: null });
    }
    await prisma.providerConnection.update({ where: { id: cid }, data });
    await audit(prisma, id, user.id, "connection.update", "connection", cid, { fields: Object.keys(body) });
    return { ok: true };
  });

  app.delete("/api/workspaces/:id/connections/:cid", async (req) => {
    const { id, cid } = ConnParams.parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    await loadConnection(id, cid);
    // Companions using it keep their identity; the foreign key clears connectionId.
    await prisma.providerConnection.delete({ where: { id: cid } });
    await audit(prisma, id, user.id, "connection.delete", "connection", cid);
    return { revoked: null };
  });

  app.post("/api/workspaces/:id/connections/:cid/test", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const { id, cid } = ConnParams.parse(req.params);
    await requireMember(req, id, "admin");
    const conn = await loadConnection(id, cid);
    const result = await probe(conn);
    const reauth = !result.ok && result.error instanceof ProviderError && result.error.code === "reauth";
    await prisma.providerConnection.update({
      where: { id: cid },
      data: { status: result.ok ? "connected" : reauth ? "reauth" : "error", lastCheckedAt: new Date(), lastError: result.ok ? null : plainMessage(result.error) },
    });
    return result.ok ? result : { ok: false, error: plainMessage(result.error) };
  });

  app.get("/api/workspaces/:id/connections/:cid/models", async (req) => {
    const { id, cid } = ConnParams.parse(req.params);
    await requireMember(req, id, "member");
    const conn = await loadConnection(id, cid);
    try {
      return { models: await clientFor(conn).listModels(AbortSignal.timeout(20_000)) };
    } catch (e) {
      throw new HttpError(502, "provider_error", plainMessage(e));
    }
  });
}
