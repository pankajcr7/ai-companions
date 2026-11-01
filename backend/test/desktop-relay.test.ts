import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { desktopCall } from "../src/files/desktop.js";
import { client, makeApp, signUp } from "./helpers.js";

const app = await makeApp();
afterAll(() => app.close());

async function owner() {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const userId = (await req("GET", "/api/me")).json().user.id as string;
  const device = `dev-${randomUUID()}`;
  const poll = (wait = 0, c = cookie) => client(app, c)("GET", `/api/desktop/poll?device=${device}&wait=${wait}`);
  const reply = (body: object) => req("POST", "/api/desktop/reply", { device, ...body });
  return { cookie, userId, device, poll, reply, project: { id: "p1", deviceId: device, createdById: userId } };
}

test("a call reaches a waiting poll, and the app's answer comes back", async () => {
  const o = await owner();
  await o.poll();
  const waiting = o.poll(5);
  const call = desktopCall(o.project, "read", { path: "a.md" });
  const { calls } = (await waiting).json();
  expect(calls).toEqual([{ id: expect.any(String), projectId: "p1", op: "read", args: { path: "a.md" } }]);
  expect((await o.reply({ id: calls[0].id, ok: true, result: { base64: "aGk=" } })).statusCode).toBe(200);
  expect(await call).toEqual({ base64: "aGk=" });
});

test("a call made between polls is delivered on the next poll", async () => {
  const o = await owner();
  await o.poll();
  const call = desktopCall(o.project, "list", {});
  const { calls } = (await o.poll()).json();
  expect(calls.map((c: { op: string }) => c.op)).toEqual(["list"]);
  await o.reply({ id: calls[0].id, ok: true, result: { entries: [] } });
  expect(await call).toEqual({ entries: [] });
});

test("without the app connected, the call says to open the app", async () => {
  const o = await owner();
  await expect(desktopCall(o.project, "list", {})).rejects.toMatchObject({ status: 409, code: "desktop_offline" });
  await o.poll();
  await expect(desktopCall({ ...o.project, createdById: "someone-else" }, "list", {})).rejects.toMatchObject({ code: "desktop_offline" });
});

test("an app install signed in as someone else gets only that person's requests", async () => {
  const o = await owner();
  await o.poll();
  const other = await signUp(app);
  expect((await o.poll(0, other.cookie)).json()).toEqual({ calls: [] });
  const call = desktopCall(o.project, "list", {});
  expect((await o.poll(0, other.cookie)).json()).toEqual({ calls: [] });
  const { calls } = (await o.poll()).json();
  expect(calls.map((c: { op: string }) => c.op)).toEqual(["list"]);
  // Another person can't answer it either.
  await client(app, other.cookie)("POST", "/api/desktop/reply", { device: o.device, id: calls[0].id, ok: true, result: { entries: ["forged"] } });
  await o.reply({ id: calls[0].id, ok: true, result: { entries: [] } });
  expect(await call).toEqual({ entries: [] });
});

test("the app's errors come back with their meaning", async () => {
  const o = await owner();
  await o.poll();
  const call = desktopCall(o.project, "write", { path: "a.md", content: "x", base: 5 });
  const { calls } = (await o.poll()).json();
  await o.reply({ id: calls[0].id, ok: false, error: { code: "conflict", message: "This file changed since you opened it." } });
  await expect(call).rejects.toMatchObject({ status: 409, message: "This file changed since you opened it." });
});

test("an answer after the call gave up is ignored", async () => {
  const o = await owner();
  await o.poll();
  const call = desktopCall(o.project, "list", {}, 50);
  await expect(call).rejects.toMatchObject({ code: "desktop_timeout" });
  const { calls } = (await o.poll()).json();
  expect(calls).toEqual([]);
  expect((await o.reply({ id: "gone", ok: true, result: {} })).statusCode).toBe(200);
});
