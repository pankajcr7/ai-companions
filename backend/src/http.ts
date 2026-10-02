import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

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
