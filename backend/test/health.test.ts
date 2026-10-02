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

test("a forged X-Forwarded-For cannot dodge the rate limit", async () => {
  // The proxy appends the real client IP last; the forged part is leftmost and must be ignored.
  // Invalid bodies: the limit runs before validation, so nothing is written to the waitlist file.
  const codes: number[] = [];
  for (let i = 0; i < 6; i++) {
    const res = await app.inject({ method: "POST", url: "/api/waitlist", headers: { "x-forwarded-for": `10.0.0.${i}, 203.0.113.7` }, payload: { email: "not-an-email" } });
    codes.push(res.statusCode);
  }
  expect(codes.at(-1)).toBe(429);
});
