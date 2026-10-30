import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { answer, poll } from "../files/desktop.js";
import { requireUser } from "../http.js";

const Device = z.string().min(8).max(64);
const Reply = z.object({
  device: Device,
  id: z.string().min(1).max(64),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.object({ code: z.string().max(40).optional(), message: z.string().max(500) }).optional(),
});

// The app polls all day: remembering who's signed in per cookie for a minute keeps the database out of it.
// ponytail: a signed-out cookie keeps polling for up to a minute; fine for a relay that only reaches the user's own folders.
const signedIn = new Map<string, { userId: string; until: number }>();
async function userIdOf(req: FastifyRequest) {
  const key = req.headers.cookie ?? "";
  const hit = signedIn.get(key);
  if (hit && hit.until > Date.now()) return hit.userId;
  const user = await requireUser(req);
  signedIn.set(key, { userId: user.id, until: Date.now() + 60_000 });
  if (signedIn.size > 1000) signedIn.delete(signedIn.keys().next().value!);
  return user.id;
}

export async function desktopRoutes(app: FastifyInstance) {
  app.get("/api/desktop/poll", async (req) => {
    const q = z.object({ device: Device, wait: z.coerce.number().min(0).max(20).default(20) }).parse(req.query);
    return { calls: await poll(q.device, await userIdOf(req), q.wait * 1000) };
  });

  // A file read comes back as base64: up to 10 MB of file.
  app.post("/api/desktop/reply", { bodyLimit: 16 * 1024 * 1024 }, async (req) => {
    const b = Reply.parse(req.body);
    answer(b.device, await userIdOf(req), b.id, b.ok, b.result, b.error);
    return { ok: true };
  });
}
