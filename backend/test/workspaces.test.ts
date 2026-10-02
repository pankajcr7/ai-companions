import { afterAll, expect, test } from "vitest";
import { client, makeApp, signUp } from "./helpers.js";

const app = await makeApp();
afterAll(() => app.close());

async function owner(template = "starter") {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const res = await req("POST", "/api/workspaces", { name: "Asha Bakery", template });
  expect(res.statusCode).toBe(201);
  return { req, id: res.json().id as string, slug: res.json().slug as string };
}

test("starter template creates 5 companions, one head, desks inside zones", async () => {
  const { req, id, slug } = await owner();
  expect(slug).toMatch(/^asha-bakery/);
  const s = (await req("GET", `/api/workspaces/${id}`)).json();
  expect(s.role).toBe("owner");
  expect(s.agents).toHaveLength(5);
  expect(s.departments.map((d: { name: string }) => d.name)).toEqual(["Leadership", "Product", "Engineering", "Design", "Content"]);
  expect(s.agents.filter((a: { isHead: boolean }) => a.isHead)).toHaveLength(1);
  for (const a of s.agents) {
    const z = s.layout.zones.find((z: { departmentId: string }) => z.departmentId === a.departmentId);
    const d = s.layout.desks[a.id];
    expect(d.x >= z.x && d.x <= z.x + z.w && d.y >= z.y && d.y <= z.y + z.h).toBe(true);
    expect(a.status).toBe("active");
  }
  expect(s.preferences).toEqual({ theme: "system", reducedMotion: false, calmMode: false });
});

test("studio template wires every specialist up to the head agent", async () => {
  const { req, id } = await owner("studio");
  const { agents } = (await req("GET", `/api/workspaces/${id}`)).json();
  expect(agents).toHaveLength(13);
  const byId = new Map(agents.map((a: { id: string }) => [a.id, a]));
  for (const a of agents) {
    let cur = a;
    for (let i = 0; i < 5 && !cur.isHead; i++) cur = byId.get(cur.managerId);
    expect(cur.isHead).toBe(true);
  }
});

test("head-only template creates just the head agent", async () => {
  const { req, id } = await owner("head-only");
  expect((await req("GET", `/api/workspaces/${id}`)).json().agents).toHaveLength(1);
});

test("same company name gets a different slug", async () => {
  const a = await owner();
  const b = await owner();
  expect(a.slug).not.toBe(b.slug);
});

test("bad input is rejected with 400", async () => {
  const { cookie } = await signUp(app);
  const res = await client(app, cookie)("POST", "/api/workspaces", { name: "", template: "huge" });
  expect(res.statusCode).toBe(400);
  expect(res.json().error.code).toBe("invalid");
});

test("another user cannot see the workspace: 404", async () => {
  const { id } = await owner();
  const { cookie } = await signUp(app);
  const res = await client(app, cookie)("GET", `/api/workspaces/${id}`);
  expect(res.statusCode).toBe(404);
});

test("signed-out create is 401", async () => {
  const res = await app.inject({ method: "POST", url: "/api/workspaces", payload: { name: "X", template: "starter" } });
  expect(res.statusCode).toBe(401);
});
