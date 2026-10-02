import { randomUUID } from "node:crypto";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../src/app.js";

export const ORIGIN = "http://localhost:3000";

export async function makeApp() {
  const app = await buildApp();
  await app.ready();
  return app;
}

export async function signUp(app: FastifyInstance, email = `u-${randomUUID()}@test.dev`) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: ORIGIN },
    payload: { email, password: "correct-horse-1", name: "Test User" },
  });
  if (res.statusCode !== 200) throw new Error(`sign-up failed: ${res.statusCode} ${res.body}`);
  const cookie = [res.headers["set-cookie"]].flat().map((c) => String(c).split(";")[0]).join("; ");
  return { cookie, email };
}

/** Request helper bound to one signed-in user. */
export function client(app: FastifyInstance, cookie: string) {
  return (method: InjectOptions["method"], url: string, payload?: unknown) =>
    app.inject({ method, url, payload: payload as InjectOptions["payload"], headers: { cookie, origin: ORIGIN } });
}
