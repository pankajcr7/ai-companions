import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { ZodError } from "zod";
import { auth } from "./auth.js";
import { prisma, type Db } from "./db.js";
import type { Prisma, Role } from "./generated/prisma/client.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  const send = (status: number, code: string, message: string) => reply.status(status).send({ error: { code, message } });
  if (err instanceof HttpError) return send(err.status, err.code, err.message);
  if (err instanceof ZodError) {
    return send(400, "invalid", err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  }
  if ((err as { code?: string }).code === "P2002") return send(409, "conflict", "That name is already taken");
  const status = (err as FastifyError).statusCode ?? 500;
  if (status === 429) return send(429, "rate_limited", "Too many requests. Wait a minute and try again.");
  if (status < 500) return send(status, "bad_request", err.message);
  req.log.error(err);
  return send(500, "server_error", "Something went wrong");
}

export async function requireUser(req: FastifyRequest) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) throw new HttpError(401, "unauthenticated", "Sign in first");
  return session.user;
}

const rank: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

export async function requireMember(req: FastifyRequest, workspaceId: string, min: Role = "viewer") {
  const user = await requireUser(req);
  const membership = await prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId, userId: user.id } } });
  // 404, not 403, so workspace ids can't be probed.
  if (!membership) throw new HttpError(404, "not_found", "Workspace not found");
  if (rank[membership.role] < rank[min]) throw new HttpError(403, "forbidden", "Your role can't do that");
  return { user, role: membership.role };
}

export function audit(
  db: Db,
  workspaceId: string,
  actorUserId: string,
  action: string,
  targetType: string,
  targetId: string,
  data?: Prisma.InputJsonValue,
) {
  return db.auditLog.create({ data: { workspaceId, actorUserId, action, targetType, targetId, data } });
}

/** Rate-limit key: the Better Auth session token only (extra cookies can't mint new buckets), else the IP. */
export const perUser = (req: FastifyRequest) =>
  /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]+)/.exec(req.headers.cookie ?? "")?.[1] ?? req.ip;
