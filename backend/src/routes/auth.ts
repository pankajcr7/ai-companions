import type { FastifyInstance } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { auth, googleEnabled } from "../auth.js";
import { prisma } from "../db.js";
import { requireUser } from "../http.js";

export async function authRoutes(app: FastifyInstance) {
  // Better Auth speaks Fetch Request/Response; translate from Fastify.
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    config: { rateLimit: { max: 100, timeWindow: "1 minute" } },
    async handler(req, reply) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const response = await auth.handler(
        new Request(url, {
          method: req.method,
          headers: fromNodeHeaders(req.headers),
          ...(req.body ? { body: JSON.stringify(req.body) } : {}),
        }),
      );
      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      return reply.send(response.body ? await response.text() : null);
    },
  });

  app.get("/api/auth-config", async () => ({ google: googleEnabled }));

  app.get("/api/me", async (req) => {
    const user = await requireUser(req);
    const memberships = await prisma.membership.findMany({
      where: { userId: user.id },
      include: { workspace: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: "asc" },
    });
    return {
      user: { id: user.id, name: user.name, email: user.email },
      workspaces: memberships.map((m) => ({ ...m.workspace, role: m.role })),
    };
  });
}
