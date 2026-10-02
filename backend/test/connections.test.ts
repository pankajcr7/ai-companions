import { afterAll, beforeEach, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { client, makeApp, signUp } from "./helpers.js";
import { fakeServer, json } from "./fake-provider.js";

const app = await makeApp();
const fake = await fakeServer({
  "GET /v1/models": (q, res) => (q.headers.authorization === "Bearer sk-good-1234" || !q.headers.authorization ? json(res, 200, { data: [{ id: "m-1" }, { id: "m-2" }] }) : json(res, 401, { error: { message: "bad key" } })),
});
afterAll(async () => {
  await fake.close();
  await app.close();
});
beforeEach(() => {
  process.env.TEST_OPENAI_BASE_URL = `${fake.url}/v1`;
  process.env.ALLOW_LOCAL_ENDPOINTS = "true";
});

async function owner() {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const id = (await req("POST", "/api/workspaces", { name: "Conn Co", template: "starter" })).json().id as string;
  return { req, id };
}

test("owner adds an OpenAI key: tested, saved encrypted, never returned", async () => {
  const { req, id } = await owner();
  const res = await req("POST", `/api/workspaces/${id}/connections`, { kind: "openai", label: "My OpenAI", apiKey: "sk-good-1234" });
  expect(res.statusCode).toBe(201);
  const list = await req("GET", `/api/workspaces/${id}/connections`);
  expect(list.body).not.toContain("sk-good-1234");
  expect(list.json().connections[0]).toMatchObject({ kind: "openai", label: "My OpenAI", hint: "sk-…1234", status: "connected" });
  const row = await prisma.providerConnection.findFirstOrThrow({ where: { workspaceId: id } });
  expect(row.secret!.startsWith("v1:")).toBe(true);
  expect(row.secret).not.toContain("sk-good");
});

test("a rejected key is not saved and the reason is shown", async () => {
  const { req, id } = await owner();
  const res = await req("POST", `/api/workspaces/${id}/connections`, { kind: "openai", label: "Bad", apiKey: "sk-bad-9999" });
  expect(res.statusCode).toBe(400);
  expect(res.json().error.message).toMatch(/rejected the key/);
  expect(await prisma.providerConnection.count({ where: { workspaceId: id } })).toBe(0);
});

test("custom endpoint without a key uses the host as the hint", async () => {
  const { req, id } = await owner();
  const res = await req("POST", `/api/workspaces/${id}/connections`, { kind: "custom", label: "Local", baseUrl: `${fake.url}/v1/` });
  expect(res.statusCode).toBe(201);
  const c = (await req("GET", `/api/workspaces/${id}/connections`)).json().connections[0];
  expect(c).toMatchObject({ kind: "custom", baseUrl: `${fake.url}/v1`, hint: new URL(fake.url).host });
});

test("private custom URL is refused when local endpoints are not allowed", async () => {
  const { req, id } = await owner();
  process.env.ALLOW_LOCAL_ENDPOINTS = "false";
  const res = await req("POST", `/api/workspaces/${id}/connections`, { kind: "custom", label: "Sneaky", baseUrl: "https://169.254.169.254/latest" });
  expect(res.statusCode).toBe(400);
  expect(res.json().error.message).toMatch(/private network/);
});

test("validation: key required for key providers, URL required for custom", async () => {
  const { req, id } = await owner();
  expect((await req("POST", `/api/workspaces/${id}/connections`, { kind: "anthropic", label: "A" })).statusCode).toBe(400);
  expect((await req("POST", `/api/workspaces/${id}/connections`, { kind: "custom", label: "C" })).statusCode).toBe(400);
  expect((await req("POST", `/api/workspaces/${id}/connections`, { kind: "chatgpt", label: "G", apiKey: "x" })).statusCode).toBe(400);
});

test("roles: member cannot add, viewer can list, stranger gets 404", async () => {
  const { req, id } = await owner();
  const member = await signUp(app);
  const viewer = await signUp(app);
  for (const [u, role] of [[member, "member"], [viewer, "viewer"]] as const) {
    const me = (await client(app, u.cookie)("GET", "/api/me")).json();
    await prisma.membership.create({ data: { workspaceId: id, userId: me.user.id, role } });
  }
  expect((await client(app, member.cookie)("POST", `/api/workspaces/${id}/connections`, { kind: "openai", label: "X", apiKey: "sk-good-1234" })).statusCode).toBe(403);
  expect((await client(app, viewer.cookie)("GET", `/api/workspaces/${id}/connections`)).statusCode).toBe(200);
  const stranger = await signUp(app);
  expect((await client(app, stranger.cookie)("GET", `/api/workspaces/${id}/connections`)).statusCode).toBe(404);
  await req("GET", `/api/workspaces/${id}`);
});

test("test, models, rename, replace key", async () => {
  const { req, id } = await owner();
  const cid = (await req("POST", `/api/workspaces/${id}/connections`, { kind: "openai", label: "O", apiKey: "sk-good-1234" })).json().id;
  expect((await req("POST", `/api/workspaces/${id}/connections/${cid}/test`)).json()).toEqual({ ok: true, models: 2 });
  expect((await req("GET", `/api/workspaces/${id}/connections/${cid}/models`)).json().models).toEqual([{ id: "m-1", label: "m-1" }, { id: "m-2", label: "m-2" }]);
  expect((await req("PATCH", `/api/workspaces/${id}/connections/${cid}`, { apiKey: "sk-bad-0000" })).statusCode).toBe(400);
  expect((await req("PATCH", `/api/workspaces/${id}/connections/${cid}`, { label: "Renamed" })).statusCode).toBe(200);
  expect((await req("GET", `/api/workspaces/${id}/connections`)).json().connections[0].label).toBe("Renamed");
});

test("failed test marks the connection as error with the reason", async () => {
  const { req, id } = await owner();
  const cid = (await req("POST", `/api/workspaces/${id}/connections`, { kind: "openai", label: "O", apiKey: "sk-good-1234" })).json().id;
  fake.routes["GET /v1/models"] = (_q, res) => json(res, 503, {});
  const r = (await req("POST", `/api/workspaces/${id}/connections/${cid}/test`)).json();
  expect(r).toMatchObject({ ok: false });
  const c = (await req("GET", `/api/workspaces/${id}/connections`)).json().connections[0];
  expect(c).toMatchObject({ status: "error", lastError: expect.stringMatching(/trouble/) });
  fake.routes["GET /v1/models"] = (_q, res) => json(res, 200, { data: [{ id: "m-1" }, { id: "m-2" }] });
});

test("removing a connection unassigns companions that use it", async () => {
  const { req, id } = await owner();
  const cid = (await req("POST", `/api/workspaces/${id}/connections`, { kind: "openai", label: "O", apiKey: "sk-good-1234" })).json().id;
  const agent = await prisma.agent.findFirstOrThrow({ where: { workspaceId: id } });
  await prisma.agent.update({ where: { id: agent.id }, data: { connectionId: cid, model: "m-1" } });
  const del = await req("DELETE", `/api/workspaces/${id}/connections/${cid}`);
  expect(del.statusCode).toBe(200);
  expect(del.json()).toEqual({ revoked: null });
  expect((await prisma.agent.findUniqueOrThrow({ where: { id: agent.id } })).connectionId).toBeNull();
});

test("junk extra cookies don't create new rate-limit buckets for the same user", async () => {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const id = (await req("POST", "/api/workspaces", { name: "Limit Co", template: "head-only" })).json().id as string;
  const codes: number[] = [];
  for (let i = 0; i < 6; i++) {
    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${id}/connections/chatgpt/start`,
      headers: { cookie: `${cookie}; junk=${i}`, origin: "http://localhost:3000" },
      payload: {},
    });
    codes.push(res.statusCode);
  }
  expect(codes.at(-1)).toBe(429);
});
