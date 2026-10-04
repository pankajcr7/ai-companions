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
import { uploadRoutes } from "./routes/uploads.js";
import { fileRoutes } from "./routes/files.js";
import { goalChatRoutes } from "./routes/goal-chat.js";
import { previewRoutes } from "./routes/preview.js";
import { searchKeyRoutes } from "./routes/search-key.js";
import { conversationRoutes } from "./routes/conversations.js";
import { goalRoutes } from "./routes/goals.js";
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
  await app.register(uploadRoutes);
  await app.register(fileRoutes);
  await app.register(goalRoutes);
  await app.register(goalChatRoutes);
  await app.register(previewRoutes);
  await app.register(conversationRoutes);
  await app.register(searchKeyRoutes);
  await app.register(waitlistRoutes);
  return app;
}
