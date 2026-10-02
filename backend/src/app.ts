import "./env.js";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { errorHandler } from "./http.js";
import { authRoutes } from "./routes/auth.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { agentRoutes } from "./routes/agents.js";
import { connectionRoutes } from "./routes/connections.js";
import { chatgptRoutes } from "./routes/chatgpt.js";
import { chatRoutes } from "./routes/chat.js";
import { projectRoutes } from "./routes/projects.js";
import { waitlistRoutes } from "./routes/waitlist.js";

export async function buildApp() {
  // Trust only the local Next.js proxy: it appends the real client IP; earlier X-Forwarded-For entries are client-forged.
  const app = Fastify({ logger: process.env.VITEST ? false : { redact: ["req.headers.authorization", "req.headers.cookie", 'req.headers["x-api-key"]'] }, trustProxy: ["127.0.0.1", "::1"] });
  await app.register(rateLimit, { global: false });
  app.setErrorHandler(errorHandler);
  app.get("/health", async () => ({ ok: true }));
  await app.register(authRoutes);
  await app.register(workspaceRoutes);
  await app.register(agentRoutes);
  await app.register(connectionRoutes);
  await app.register(chatgptRoutes);
  await app.register(chatRoutes);
  await app.register(projectRoutes);
  await app.register(waitlistRoutes);
  return app;
}
