import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const app = Fastify({ logger: true });
await app.register(cors, { origin: process.env.FRONTEND_URL ?? "http://localhost:3000" });
await app.register(rateLimit, { global: false });

app.get("/health", async () => ({ ok: true }));

// ponytail: JSON file store, single process only. Move to Postgres with the rest of the data model.
const DATA_DIR = new URL("../data/", import.meta.url);
const WAITLIST = new URL("waitlist.json", DATA_DIR);

app.post<{ Body: { email: string; name?: string; goal?: string } }>(
  "/waitlist",
  {
    schema: {
      body: {
        type: "object",
        required: ["email"],
        additionalProperties: false,
        properties: {
          email: { type: "string", format: "email", maxLength: 254 },
          name: { type: "string", maxLength: 120 },
          goal: { type: "string", maxLength: 1000 },
        },
      },
    },
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  },
  async (req, reply) => {
    const email = req.body.email.trim().toLowerCase();
    await mkdir(DATA_DIR, { recursive: true });
    const list: { email: string; name?: string; goal?: string; at: string }[] = JSON.parse(await readFile(WAITLIST, "utf8").catch(() => "[]"));
    if (!list.some((e) => e.email === email)) {
      list.push({ email, name: req.body.name?.trim() || undefined, goal: req.body.goal?.trim() || undefined, at: new Date().toISOString() });
      await writeFile(WAITLIST, JSON.stringify(list, null, 2));
    }
    // Same response for new and existing emails, so the endpoint can't be used to check who signed up.
    return reply.code(201).send({ ok: true });
  },
);

await app.listen({ port: Number(process.env.PORT ?? 4000), host: "0.0.0.0" });
