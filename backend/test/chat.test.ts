import type { ServerResponse } from "node:http";
import { afterAll, beforeEach, expect, test } from "vitest";
import { encryptSecret } from "../src/crypto.js";
import { prisma } from "../src/db.js";
import { trimTurns } from "../src/companion.js";
import { client, makeApp, ORIGIN, signUp } from "./helpers.js";
import { fakeServer, json, sse, type FakeRequest } from "./fake-provider.js";

const chunk = (content: string) => JSON.stringify({ model: "fake-1", choices: [{ delta: { content } }] });
const okReply = (_q: FakeRequest, res: ServerResponse) =>
  sse(res, [chunk("Hello "), chunk("owner"), JSON.stringify({ choices: [], usage: { prompt_tokens: 40, completion_tokens: 2 } }), "[DONE]"]);
const fake = await fakeServer({ "GET /v1/models": (_q, res) => json(res, 200, { data: [{ id: "fake-1" }] }), "POST /v1/chat/completions": okReply });
const app = await makeApp();
afterAll(async () => {
  await fake.close();
  await app.close();
});
beforeEach(() => {
  process.env.ALLOW_LOCAL_ENDPOINTS = "true";
  fake.routes["POST /v1/chat/completions"] = okReply;
});

const parseEvents = (body: string) =>
  body.split("\n\n").filter(Boolean).map((block) => {
    const event = /event: (.*)/.exec(block)?.[1];
    const data = /data: (.*)/.exec(block)?.[1];
    return { event, data: data ? JSON.parse(data) : null };
  });

async function setup() {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const id = (await req("POST", "/api/workspaces", { name: "Chat Co", template: "starter" })).json().id as string;
  const cid = (await req("POST", `/api/workspaces/${id}/connections`, { kind: "custom", label: "Fake", baseUrl: `${fake.url}/v1` })).json().id as string;
  const snap = (await req("GET", `/api/workspaces/${id}`)).json();
  const nova = snap.agents.find((a: { isHead: boolean }) => a.isHead);
  return { req, id, cid, nova, cookie };
}

test("unassigned companion explains what to do", async () => {
  const { req, id, nova } = await setup();
  const res = await req("POST", `/api/workspaces/${id}/agents/${nova.id}/chat`, { message: "Hi" });
  expect(res.statusCode).toBe(409);
  expect(res.json().error.message).toMatch(/Choose an AI model for Nova/);
});

test("assigning a connection and model shows in the snapshot; foreign connections are rejected", async () => {
  const a = await setup();
  const b = await setup();
  expect((await a.req("PATCH", `/api/workspaces/${a.id}/agents/${a.nova.id}`, { connectionId: a.cid, model: "fake-1" })).statusCode).toBe(200);
  const snap = (await a.req("GET", `/api/workspaces/${a.id}`)).json();
  expect(snap.agents.find((x: { id: string }) => x.id === a.nova.id)).toMatchObject({ connectionId: a.cid, model: "fake-1" });
  expect(snap.connections[0]).toMatchObject({ id: a.cid, kind: "custom", label: "Fake" });
  expect(JSON.stringify(snap)).not.toContain("secret");
  expect((await a.req("PATCH", `/api/workspaces/${a.id}/agents/${a.nova.id}`, { connectionId: b.cid })).statusCode).toBe(400);
});

test("a chat reply streams, then both messages are saved with tokens", async () => {
  const { req, id, cid, nova } = await setup();
  await req("PATCH", `/api/workspaces/${id}/agents/${nova.id}`, { connectionId: cid, model: "fake-1" });
  const res = await req("POST", `/api/workspaces/${id}/agents/${nova.id}/chat`, { message: "Plan my launch" });
  expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
  const events = parseEvents(res.body);
  expect(events.map((e) => e.event)).toEqual(["start", "delta", "delta", "done"]);
  expect(events.at(-1)!.data).toMatchObject({ model: "fake-1", inputTokens: 40, outputTokens: 2 });
  const sent = fake.requests.at(-1)!.body as { model: string; messages: { role: string; content: string }[] };
  expect(sent.model).toBe("fake-1");
  expect(sent.messages[0].role).toBe("system");
  expect(sent.messages[0].content).toMatch(/You are Nova, the Head agent/);
  expect(sent.messages.at(-1)).toEqual({ role: "user", content: "Plan my launch" });
  const history = (await req("GET", `/api/workspaces/${id}/agents/${nova.id}/chat`)).json().messages;
  expect(history.map((m: { role: string; content: string; status: string }) => [m.role, m.content, m.status])).toEqual([
    ["user", "Plan my launch", "complete"],
    ["assistant", "Hello owner", "complete"],
  ]);
  expect(history[1]).toMatchObject({ inputTokens: 40, outputTokens: 2, model: "fake-1" });
});

test("provider errors are sent as an error event and saved on the message", async () => {
  const { req, id, cid, nova } = await setup();
  await req("PATCH", `/api/workspaces/${id}/agents/${nova.id}`, { connectionId: cid, model: "fake-1" });
  fake.routes["POST /v1/chat/completions"] = (_q, res) => json(res, 401, { error: { message: "nope" } });
  const events = parseEvents((await req("POST", `/api/workspaces/${id}/agents/${nova.id}/chat`, { message: "Hi" })).body);
  expect(events.at(-1)).toMatchObject({ event: "error", data: { code: "auth" } });
  const last = (await req("GET", `/api/workspaces/${id}/agents/${nova.id}/chat`)).json().messages.at(-1);
  expect(last).toMatchObject({ role: "assistant", status: "error", errorCode: "auth" });
});

test("a temporary failure before any text is retried once", async () => {
  const { req, id, cid, nova } = await setup();
  await req("PATCH", `/api/workspaces/${id}/agents/${nova.id}`, { connectionId: cid, model: "fake-1" });
  let calls = 0;
  fake.routes["POST /v1/chat/completions"] = (q, res) => (++calls === 1 ? json(res, 503, {}) : okReply(q, res));
  const events = parseEvents((await req("POST", `/api/workspaces/${id}/agents/${nova.id}/chat`, { message: "Hi" })).body);
  expect(calls).toBe(2);
  expect(events.at(-1)!.event).toBe("done");
});

test("a failure after text has streamed is not retried and keeps the partial text", async () => {
  const { req, id, cid, nova } = await setup();
  await req("PATCH", `/api/workspaces/${id}/agents/${nova.id}`, { connectionId: cid, model: "fake-1" });
  let calls = 0;
  fake.routes["POST /v1/chat/completions"] = (_q, res) => {
    calls++;
    sse(res, [chunk("Half")]);
  };
  const events = parseEvents((await req("POST", `/api/workspaces/${id}/agents/${nova.id}/chat`, { message: "Hi" })).body);
  expect(calls).toBe(1);
  expect(events.at(-1)!.event).toBe("error");
  const last = (await req("GET", `/api/workspaces/${id}/agents/${nova.id}/chat`)).json().messages.at(-1);
  expect(last).toMatchObject({ content: "Half", status: "error" });
});

test("closing the connection mid-reply saves the partial reply as stopped", async () => {
  const { req, id, cid, nova, cookie } = await setup();
  await req("PATCH", `/api/workspaces/${id}/agents/${nova.id}`, { connectionId: cid, model: "fake-1" });
  fake.routes["POST /v1/chat/completions"] = (_q, res) => sse(res, [chunk("Partial ")], { end: false });
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  const ac = new AbortController();
  const res = await fetch(`${address}/api/workspaces/${id}/agents/${nova.id}/chat`, {
    method: "POST",
    headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ message: "Hi" }),
    signal: ac.signal,
  });
  const reader = res.body!.getReader();
  let text = "";
  while (!text.includes("Partial")) text += new TextDecoder().decode((await reader.read()).value);
  ac.abort();
  let last;
  for (let i = 0; i < 40 && last?.status !== "stopped"; i++) {
    await new Promise((r) => setTimeout(r, 250));
    last = await prisma.chatMessage.findFirst({ where: { agentId: nova.id, role: "assistant" }, orderBy: { createdAt: "desc" } });
  }
  expect(last).toMatchObject({ status: "stopped", content: "Partial " });
});

test("only the last 20 complete messages are sent, starting with a user turn", async () => {
  const { req, id, cid, nova } = await setup();
  await req("PATCH", `/api/workspaces/${id}/agents/${nova.id}`, { connectionId: cid, model: "fake-1" });
  const userId = (await req("GET", "/api/me")).json().user.id;
  for (let i = 0; i < 30; i++) {
    await prisma.chatMessage.create({ data: { workspaceId: id, agentId: nova.id, userId, role: i % 2 ? "assistant" : "user", content: `m${i}`, createdAt: new Date(Date.now() - (60 - i) * 1000) } });
  }
  await req("POST", `/api/workspaces/${id}/agents/${nova.id}/chat`, { message: "latest" });
  const sent = (fake.requests.at(-1)!.body as { messages: { role: string; content: string }[] }).messages;
  expect(sent.length).toBeLessThanOrEqual(22);
  expect(sent[1].role).toBe("user");
  expect(sent.at(-1)!.content).toBe("latest");
});

test("trimTurns keeps the newest turns within the character budget", () => {
  const turns = [
    { role: "user" as const, content: "a".repeat(10) },
    { role: "assistant" as const, content: "b".repeat(10) },
    { role: "user" as const, content: "c".repeat(10) },
  ];
  expect(trimTurns(turns, 15).map((t) => t.content[0])).toEqual(["c"]);
  expect(trimTurns(turns, 100).map((t) => t.content[0])).toEqual(["a", "b", "c"]);
});

test("viewers cannot chat, other members see only their own threads, clear empties it", async () => {
  const { req, id, cid, nova } = await setup();
  await req("PATCH", `/api/workspaces/${id}/agents/${nova.id}`, { connectionId: cid, model: "fake-1" });
  await req("POST", `/api/workspaces/${id}/agents/${nova.id}/chat`, { message: "Mine" });
  const viewer = await signUp(app);
  const member = await signUp(app);
  for (const [u, role] of [[viewer, "viewer"], [member, "member"]] as const) {
    const me = (await client(app, u.cookie)("GET", "/api/me")).json();
    await prisma.membership.create({ data: { workspaceId: id, userId: me.user.id, role } });
  }
  expect((await client(app, viewer.cookie)("POST", `/api/workspaces/${id}/agents/${nova.id}/chat`, { message: "x" })).statusCode).toBe(403);
  expect((await client(app, member.cookie)("GET", `/api/workspaces/${id}/agents/${nova.id}/chat`)).json().messages).toEqual([]);
  expect((await req("DELETE", `/api/workspaces/${id}/agents/${nova.id}/chat`)).statusCode).toBe(204);
  expect((await req("GET", `/api/workspaces/${id}/agents/${nova.id}/chat`)).json().messages).toEqual([]);
});

test("paused companions don't chat", async () => {
  const { req, id, cid, nova } = await setup();
  await req("PATCH", `/api/workspaces/${id}/agents/${nova.id}`, { connectionId: cid, model: "fake-1", status: "paused" });
  const res = await req("POST", `/api/workspaces/${id}/agents/${nova.id}/chat`, { message: "Hi" });
  expect(res.statusCode).toBe(409);
  expect(res.json().error.message).toMatch(/Resume Nova/);
});

test("a rejected ChatGPT token marks the connection as needing sign-in", async () => {
  const { req, id, nova } = await setup();
  process.env.TEST_OPENAI_BASE_URL = `${fake.url}/v1`;
  fake.routes["POST /v1/responses"] = (_q, res) => json(res, 401, { error: { message: "expired" } });
  const userId = (await req("GET", "/api/me")).json().user.id;
  const secret = { clientId: "c", subject: "s", email: "e@x.y", idToken: "i", accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3_600_000, scopes: [] };
  const conn = await prisma.providerConnection.create({ data: { workspaceId: id, kind: "chatgpt", label: "ChatGPT", secret: encryptSecret(JSON.stringify(secret)), createdById: userId } });
  await req("PATCH", `/api/workspaces/${id}/agents/${nova.id}`, { connectionId: conn.id, model: "gpt-a" });
  const events = parseEvents((await req("POST", `/api/workspaces/${id}/agents/${nova.id}/chat`, { message: "Hi" })).body);
  expect(events.at(-1)).toMatchObject({ event: "error", data: { code: "reauth" } });
  expect((await prisma.providerConnection.findUniqueOrThrow({ where: { id: conn.id } })).status).toBe("reauth");
});

test("stopping before the first word arrives still saves the reply as stopped", async () => {
  const { req, id, cid, nova, cookie } = await setup();
  await req("PATCH", `/api/workspaces/${id}/agents/${nova.id}`, { connectionId: cid, model: "fake-1" });
  let providerCalls = 0;
  fake.routes["POST /v1/chat/completions"] = (q, res) => {
    providerCalls++;
    setTimeout(() => okReply(q, res), 3000);
  };
  const address = await app.listen({ port: 0, host: "127.0.0.1" }).catch(() => `http://127.0.0.1:${(app.server.address() as { port: number }).port}`);
  const ac = new AbortController();
  const pending = fetch(`${address}/api/workspaces/${id}/agents/${nova.id}/chat`, {
    method: "POST",
    headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ message: "Quick stop" }),
    signal: ac.signal,
  }).catch(() => null);
  setTimeout(() => ac.abort(), 50);
  await pending;
  let last;
  for (let i = 0; i < 60 && !last; i++) {
    await new Promise((r) => setTimeout(r, 250));
    last = await prisma.chatMessage.findFirst({ where: { agentId: nova.id, role: "assistant" }, orderBy: { createdAt: "desc" } });
  }
  expect(last).toMatchObject({ status: "stopped" });
  expect(providerCalls).toBeLessThanOrEqual(1);
});
