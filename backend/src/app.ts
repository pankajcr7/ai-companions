import "./env.js";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { errorHandler } from "./http.js";
import { authRoutes } from "./routes/auth.js";
import { waitlistRoutes } from "./routes/waitlist.js";

export async function buildApp() {
  const app = Fastify({ logger: !process.env.VITEST, trustProxy: true });
  await app.register(rateLimit, { global: false });
  app.setErrorHandler(errorHandler);
  app.get("/health", async () => ({ ok: true }));
  await app.register(authRoutes);
  await app.register(waitlistRoutes);
  return app;
}
