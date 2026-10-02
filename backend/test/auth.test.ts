import { afterAll, expect, test } from "vitest";
import { client, makeApp, ORIGIN, signUp } from "./helpers.js";

const app = await makeApp();
afterAll(() => app.close());

test("sign up gives a session that /api/me recognises", async () => {
  const { cookie, email } = await signUp(app);
  const res = await client(app, cookie)("GET", "/api/me");
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ user: { email, name: "Test User" }, workspaces: [] });
  expect(res.body).not.toContain("password");
});

test("signed-out requests get 401 in the standard shape", async () => {
  const res = await app.inject({ method: "GET", url: "/api/me" });
  expect(res.statusCode).toBe(401);
  expect(res.json()).toEqual({ error: { code: "unauthenticated", message: "Sign in first" } });
});

test("sign in with the right password works and the wrong one does not", async () => {
  const { email } = await signUp(app);
  const ok = await app.inject({ method: "POST", url: "/api/auth/sign-in/email", headers: { origin: ORIGIN }, payload: { email, password: "correct-horse-1" } });
  expect(ok.statusCode).toBe(200);
  const bad = await app.inject({ method: "POST", url: "/api/auth/sign-in/email", headers: { origin: ORIGIN }, payload: { email, password: "wrong-password-9" } });
  expect(bad.statusCode).toBe(401);
});

test("auth-config reports whether Google is configured", async () => {
  const res = await app.inject({ method: "GET", url: "/api/auth-config" });
  expect(res.json()).toEqual({ google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) });
});
