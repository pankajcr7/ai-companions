import { afterAll, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { loadImageKeys } from "../src/harness/images.js";
import { fakeServer, json } from "./fake-provider.js";
import { client, makeApp, signUp } from "./helpers.js";

const ACC = "0123456789abcdef0123456789abcdef";
const app = await makeApp();
const cf = await fakeServer({
  [`GET /accounts/${ACC}/ai/models/search`]: (q, res) => (q.headers.authorization === "Bearer good-cloudflare-token-123" ? json(res, 200, { success: true, result: [] }) : json(res, 403, { success: false })),
});
const pol = await fakeServer({
  "GET /account/key": (q, res) => (q.headers.authorization === "Bearer sk_good_pollinations" ? json(res, 200, { valid: true, type: "secret" }) : json(res, 401, { error: "invalid key" })),
});
process.env.TEST_CLOUDFLARE_BASE_URL = cf.url;
process.env.TEST_POLLINATIONS_BASE_URL = pol.url;
afterAll(async () => {
  await cf.close();
  await pol.close();
  await app.close();
});

test("admins add image keys after a free check; only hints come back; keys are stored encrypted; members can't change them", async () => {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const id = (await req("POST", "/api/workspaces", { name: "Pics Co", template: "starter" })).json().id as string;
  const base = `/api/workspaces/${id}/image-keys`;
  expect((await req("GET", base)).json()).toEqual({ cloudflare: null, pollinations: null });

  const bad = await req("PUT", `${base}/cloudflare`, { accountId: ACC, apiToken: "wrong-cloudflare-token-12" });
  expect(bad.statusCode).toBe(400);
  expect(bad.json().error.message).toMatch(/rejected/);
  expect((await req("PUT", `${base}/cloudflare`, { accountId: "not-an-account", apiToken: "good-cloudflare-token-123" })).statusCode).toBe(400);
  expect((await req("PUT", `${base}/pollinations`, { apiKey: "sk_wrong_pollinations" })).statusCode).toBe(400);

  expect((await req("PUT", `${base}/cloudflare`, { accountId: ACC, apiToken: "good-cloudflare-token-123" })).json()).toEqual({ hint: "goo…-123" });
  expect((await req("PUT", `${base}/pollinations`, { apiKey: "sk_good_pollinations" })).json()).toEqual({ hint: "sk_…ions" });
  const shown = JSON.stringify((await req("GET", base)).json());
  expect(shown).toBe(JSON.stringify({ cloudflare: { hint: "goo…-123" }, pollinations: { hint: "sk_…ions" } }));
  const stored = JSON.stringify(await prisma.imageKey.findMany({ where: { workspaceId: id } }));
  expect(stored).not.toContain("good-cloudflare-token-123");
  expect(stored).not.toContain("sk_good_pollinations");
  expect(await loadImageKeys(id)).toEqual({ cloudflare: { accountId: ACC, apiToken: "good-cloudflare-token-123" }, pollinations: "sk_good_pollinations" });
  expect(await prisma.auditLog.count({ where: { workspaceId: id, action: "image_key.set" } })).toBe(2);

  const member = await signUp(app);
  const m = client(app, member.cookie);
  const mid = (await m("GET", "/api/me")).json().user.id as string;
  await prisma.membership.create({ data: { workspaceId: id, userId: mid, role: "member" } });
  expect((await m("GET", base)).json().cloudflare).toEqual({ hint: "goo…-123" });
  expect((await m("PUT", `${base}/pollinations`, { apiKey: "sk_good_pollinations" })).statusCode).toBe(403);
  expect((await m("DELETE", `${base}/pollinations`)).statusCode).toBe(403);

  expect((await req("DELETE", `${base}/pollinations`)).statusCode).toBe(204);
  expect((await loadImageKeys(id)).pollinations).toBeNull();
  expect(await prisma.auditLog.count({ where: { workspaceId: id, action: "image_key.delete" } })).toBe(1);
});
