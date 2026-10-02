import { afterAll, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { client, makeApp, signUp } from "./helpers.js";

const app = await makeApp();
afterAll(() => app.close());

async function setup() {
  const owner = await signUp(app);
  const req = client(app, owner.cookie);
  const id = (await req("POST", "/api/workspaces", { name: "Test Co", template: "starter" })).json().id as string;
  const snap = async () => (await req("GET", `/api/workspaces/${id}`)).json();
  return { req, id, snap, s: await snap() };
}

test("viewer can read and set own preferences but cannot edit", async () => {
  const { id, s } = await setup();
  const viewer = await signUp(app);
  const me = (await client(app, viewer.cookie)("GET", "/api/me")).json();
  await prisma.membership.create({ data: { workspaceId: id, userId: me.user.id, role: "viewer" } });
  const v = client(app, viewer.cookie);
  expect((await v("GET", `/api/workspaces/${id}`)).json().role).toBe("viewer");
  expect((await v("PATCH", `/api/workspaces/${id}/agents/${s.agents[1].id}`, { name: "Nope" })).statusCode).toBe(403);
  expect((await v("PUT", `/api/workspaces/${id}/layout`, s.layout)).statusCode).toBe(403);
  expect((await v("POST", `/api/workspaces/${id}/departments`, { name: "Sales" })).statusCode).toBe(403);
  expect((await v("PUT", `/api/workspaces/${id}/preferences`, { theme: "dark", reducedMotion: true, calmMode: false })).statusCode).toBe(200);
});

test("member can edit companions but not departments or the workspace name", async () => {
  const { id, s } = await setup();
  const member = await signUp(app);
  const me = (await client(app, member.cookie)("GET", "/api/me")).json();
  await prisma.membership.create({ data: { workspaceId: id, userId: me.user.id, role: "member" } });
  const m = client(app, member.cookie);
  expect((await m("PATCH", `/api/workspaces/${id}/agents/${s.agents[1].id}`, { name: "Okay" })).statusCode).toBe(200);
  expect((await m("POST", `/api/workspaces/${id}/departments`, { name: "Sales" })).statusCode).toBe(403);
  expect((await m("PATCH", `/api/workspaces/${id}`, { name: "Mine now" })).statusCode).toBe(403);
});

test("owner renames the workspace", async () => {
  const { req, id, snap } = await setup();
  expect((await req("PATCH", `/api/workspaces/${id}`, { name: "Renamed Co" })).statusCode).toBe(200);
  expect((await snap()).workspace.name).toBe("Renamed Co");
});

test("departments: add, duplicate name is 409, rename, reorder", async () => {
  const { req, id, snap } = await setup();
  const add = await req("POST", `/api/workspaces/${id}/departments`, { name: "Sales" });
  expect(add.statusCode).toBe(201);
  expect((await req("POST", `/api/workspaces/${id}/departments`, { name: "Sales" })).statusCode).toBe(409);
  const deptId = add.json().id;
  await req("PATCH", `/api/workspaces/${id}/departments/${deptId}`, { name: "Sales and support", sortOrder: -1 });
  const s = await snap();
  expect(s.departments[0]).toMatchObject({ id: deptId, name: "Sales and support" });
  expect(s.layout.zones[0].departmentId).toBe(deptId);
});

test("deleting a department leaves its companions unassigned but still in the office", async () => {
  const { req, id, snap, s } = await setup();
  const design = s.departments.find((d: { name: string }) => d.name === "Design");
  const designer = s.agents.find((a: { departmentId: string }) => a.departmentId === design.id);
  expect((await req("DELETE", `/api/workspaces/${id}/departments/${design.id}`)).statusCode).toBe(204);
  const after = await snap();
  expect(after.agents.find((a: { id: string }) => a.id === designer.id).departmentId).toBeNull();
  expect(after.layout.zones.some((z: { departmentId: string }) => z.departmentId === "unassigned")).toBe(true);
  expect(after.layout.desks[designer.id]).toBeDefined();
});

test("layout save keeps known desks and drops foreign ids", async () => {
  const { req, id, snap, s } = await setup();
  const other = await setup();
  const mine = s.agents[1].id;
  const layout = { zones: s.layout.zones, desks: { ...s.layout.desks, [mine]: { x: 999, y: 555 }, [other.s.agents[0].id]: { x: 1, y: 1 } } };
  expect((await req("PUT", `/api/workspaces/${id}/layout`, layout)).statusCode).toBe(200);
  const after = await snap();
  expect(after.layout.desks[mine]).toEqual({ x: 999, y: 555 });
  expect(after.layout.desks[other.s.agents[0].id]).toBeUndefined();
});

test("layout with absurd sizes is rejected", async () => {
  const { req, id } = await setup();
  const desks = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`a${i}`, { x: 0, y: 0 }]));
  expect((await req("PUT", `/api/workspaces/${id}/layout`, { zones: [], desks })).statusCode).toBe(400);
});

test("preferences are per user and persist", async () => {
  const { req, id, snap } = await setup();
  await req("PUT", `/api/workspaces/${id}/preferences`, { theme: "dark", reducedMotion: true, calmMode: true });
  expect((await snap()).preferences).toEqual({ theme: "dark", reducedMotion: true, calmMode: true });
});

test("non-members get 404 on every write route", async () => {
  const { id, s } = await setup();
  const stranger = client(app, (await signUp(app)).cookie);
  const routes: [string, string, unknown][] = [
    ["PATCH", `/api/workspaces/${id}`, { name: "x" }],
    ["POST", `/api/workspaces/${id}/departments`, { name: "x" }],
    ["PATCH", `/api/workspaces/${id}/departments/${s.departments[0].id}`, { name: "x" }],
    ["DELETE", `/api/workspaces/${id}/departments/${s.departments[0].id}`, undefined],
    ["PUT", `/api/workspaces/${id}/layout`, s.layout],
    ["PUT", `/api/workspaces/${id}/preferences`, { theme: "dark", reducedMotion: false, calmMode: false }],
    ["POST", `/api/workspaces/${id}/agents`, { name: "x", role: "x", appearance: { style: "robot", color: "#000000", head: "square", eyes: "dots", accessory: "none" } }],
    ["POST", `/api/workspaces/${id}/agents/${s.agents[0].id}/clone`, undefined],
  ];
  for (const [method, url, body] of routes) expect((await stranger(method as "GET", url, body)).statusCode, `${method} ${url}`).toBe(404);
});

test("a stale layout save keeps the server's zones and other people's new desks", async () => {
  const { req, id, snap, s } = await setup();
  const stale = s.layout;
  const look = { style: "robot", color: "#000000", head: "square", eyes: "dots", accessory: "none" };
  // Someone else adds an unassigned companion: a new desk and a new Unassigned zone.
  const created = (await req("POST", `/api/workspaces/${id}/agents`, { name: "New", role: "Helper", appearance: look })).json().id;
  const fresh = await snap();
  const moved = s.agents[1].id;
  await req("PUT", `/api/workspaces/${id}/layout`, { zones: stale.zones, desks: { ...stale.desks, [moved]: { x: 5, y: 6 } } });
  const after = await snap();
  expect(after.layout.desks[moved]).toEqual({ x: 5, y: 6 });
  expect(after.layout.desks[created]).toEqual(fresh.layout.desks[created]);
  expect(after.layout.zones).toEqual(fresh.layout.zones);
});
