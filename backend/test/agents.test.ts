import { afterAll, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { client, makeApp, signUp } from "./helpers.js";

const app = await makeApp();
afterAll(() => app.close());

const LOOK = { style: "robot", color: "#ff7a00", head: "tall", eyes: "wide", accessory: "cap" };

async function setup(template = "starter") {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const id = (await req("POST", "/api/workspaces", { name: "Test Co", template })).json().id as string;
  const snap = async () => (await req("GET", `/api/workspaces/${id}`)).json();
  const s = await snap();
  const head = s.agents.find((a: { isHead: boolean }) => a.isHead);
  return { req, id, snap, s, head };
}

test("create a companion: it appears with a desk", async () => {
  const { req, id, snap, s, head } = await setup();
  const res = await req("POST", `/api/workspaces/${id}/agents`, {
    name: "Zed",
    role: "SEO specialist",
    departmentId: s.departments[0].id,
    managerId: head.id,
    appearance: LOOK,
  });
  expect(res.statusCode).toBe(201);
  const after = await snap();
  const zed = after.agents.find((a: { id: string }) => a.id === res.json().id);
  expect(zed).toMatchObject({ name: "Zed", kind: "ai", status: "active", isHead: false, appearance: LOOK });
  expect(after.layout.desks[zed.id]).toBeDefined();
});

test("invalid color is 400", async () => {
  const { req, id } = await setup();
  const res = await req("POST", `/api/workspaces/${id}/agents`, { name: "Bad", role: "X", appearance: { ...LOOK, color: "orange" } });
  expect(res.statusCode).toBe(400);
});

test("reporting loops are rejected with 409", async () => {
  const { req, id, s, head } = await setup();
  const pm = s.agents.find((a: { role: string }) => a.role === "Product manager");
  const self = await req("PATCH", `/api/workspaces/${id}/agents/${pm.id}`, { managerId: pm.id });
  expect(self.statusCode).toBe(409);
  const dev = s.agents.find((a: { role: string }) => a.role === "Full-stack developer");
  await req("PATCH", `/api/workspaces/${id}/agents/${dev.id}`, { managerId: pm.id });
  const loop = await req("PATCH", `/api/workspaces/${id}/agents/${pm.id}`, { managerId: dev.id });
  expect(loop.statusCode).toBe(409);
  expect(loop.json().error.message).toBe("That would make a reporting loop");
  expect(head).toBeDefined();
});

test("head agent cannot be archived or given a manager", async () => {
  const { req, id, s, head } = await setup();
  expect((await req("PATCH", `/api/workspaces/${id}/agents/${head.id}`, { status: "archived" })).statusCode).toBe(400);
  expect((await req("PATCH", `/api/workspaces/${id}/agents/${head.id}`, { managerId: s.agents[1].id })).statusCode).toBe(400);
});

test("ids from another workspace are rejected", async () => {
  const a = await setup();
  const b = await setup();
  const target = a.s.agents[1].id;
  expect((await a.req("PATCH", `/api/workspaces/${a.id}/agents/${target}`, { departmentId: b.s.departments[0].id })).statusCode).toBe(400);
  expect((await a.req("PATCH", `/api/workspaces/${a.id}/agents/${target}`, { managerId: b.head.id })).statusCode).toBe(400);
  // and B cannot touch A's agent through B's own workspace path
  expect((await b.req("PATCH", `/api/workspaces/${b.id}/agents/${target}`, { name: "Hijack" })).statusCode).toBe(404);
  // nor through A's path
  expect((await b.req("PATCH", `/api/workspaces/${a.id}/agents/${target}`, { name: "Hijack" })).statusCode).toBe(404);
});

test("an archived companion cannot become a manager", async () => {
  const { req, id, s } = await setup();
  const [, x, y] = s.agents;
  await req("PATCH", `/api/workspaces/${id}/agents/${x.id}`, { status: "archived" });
  expect((await req("PATCH", `/api/workspaces/${id}/agents/${y.id}`, { managerId: x.id })).statusCode).toBe(400);
});

test("archive hides the desk, keeps the record, writes an audit entry", async () => {
  const { req, id, snap, s } = await setup();
  const target = s.agents[2];
  expect((await req("PATCH", `/api/workspaces/${id}/agents/${target.id}`, { status: "archived" })).statusCode).toBe(200);
  const after = await snap();
  expect(after.agents.find((a: { id: string }) => a.id === target.id).status).toBe("archived");
  expect(after.layout.desks[target.id]).toBeUndefined();
  expect(await prisma.auditLog.count({ where: { workspaceId: id, action: "agent.archive", targetId: target.id } })).toBe(1);
});

test("pause and resume are saved", async () => {
  const { req, id, snap, s } = await setup();
  const t = s.agents[1];
  await req("PATCH", `/api/workspaces/${id}/agents/${t.id}`, { status: "paused" });
  expect((await snap()).agents.find((a: { id: string }) => a.id === t.id).status).toBe("paused");
  await req("PATCH", `/api/workspaces/${id}/agents/${t.id}`, { status: "active" });
  expect((await snap()).agents.find((a: { id: string }) => a.id === t.id).status).toBe("active");
});

test("clone makes a new identity with the same profile and look", async () => {
  const { req, id, snap, head } = await setup();
  const res = await req("POST", `/api/workspaces/${id}/agents/${head.id}/clone`);
  expect(res.statusCode).toBe(201);
  const copy = (await snap()).agents.find((a: { id: string }) => a.id === res.json().id);
  expect(copy).toMatchObject({ name: "Nova copy", role: head.role, isHead: false, managerId: head.id, appearance: head.appearance });
});

test("updating appearance and profile persists", async () => {
  const { req, id, snap, s } = await setup();
  const t = s.agents[1];
  await req("PATCH", `/api/workspaces/${id}/agents/${t.id}`, { name: "Priya Prime", kind: "human", appearance: LOOK });
  expect((await snap()).agents.find((a: { id: string }) => a.id === t.id)).toMatchObject({ name: "Priya Prime", kind: "human", appearance: LOOK });
});
