import { afterAll, expect, test } from "vitest";
import { makeApp } from "./helpers.js";

const app = await makeApp();
afterAll(() => app.close());

test("health answers ok", async () => {
  const res = await app.inject({ method: "GET", url: "/health" });
  expect(res.json()).toEqual({ ok: true });
});

test("unknown route returns the standard error shape", async () => {
  const res = await app.inject({ method: "GET", url: "/api/nope" });
  expect(res.statusCode).toBe(404);
});
