import { afterAll, expect, test, vi } from "vitest";
import { prisma } from "../src/db.js";
import { client, makeApp, signUp } from "./helpers.js";
import { company, fakeLLM, fence, sleep, systemOf, userOf, waitFor } from "./goal-helpers.js";

// Each test builds whole companies at remote-database latency.
vi.setConfig({ testTimeout: 240_000 });
const llm = await fakeLLM();
const app = await makeApp();
afterAll(async () => {
  await llm.close();
  await app.close();
});

const planFor = (ids: string[], deps: number[][] = []) => ({
  tasks: ids.map((agentId, i) => ({ agentId, title: `Task ${i}`, instructions: `Do part ${i}`, deliverable: "A short note", criteria: ["Mentions the goal"], dependsOn: deps[i] ?? [] })),
});
const isPlan = (s: string) => s.includes("Turn the owner's goal into a plan");

async function goal(co: Awaited<ReturnType<typeof company>>, text = "Launch the bakery site") {
  const res = await co.req("POST", `/api/workspaces/${co.id}/goals`, { text });
  expect(res.statusCode).toBe(201);
  const gid = res.json().id as string;
  const get = async () => (await co.req("GET", `/api/workspaces/${co.id}/goals/${gid}`)).json().goal;
  return { gid, get, base: `/api/workspaces/${co.id}/goals/${gid}` };
}

test("Nova plans a goal from the roster and it waits for approval", async () => {
  const co = await company(app, llm);
  llm.setScript((s) => (isPlan(s) ? fence(planFor([co.others[0].id, co.others[1].name], [[], [0]])) : "ok"));
  const g = await goal(co);
  const planned = await waitFor(g.get, (x) => x.status !== "planning");
  expect(planned.status).toBe("awaiting_approval");
  expect(planned.tasks.map((t: { agentId: string; dependsOn: number[] }) => [t.agentId, t.dependsOn])).toEqual([
    [co.others[0].id, []],
    [co.others[1].id, [0]],
  ]);
  expect(planned.tasks[0]).toMatchObject({ title: "Task 0", deliverable: "A short note", criteria: ["Mentions the goal"], status: "pending", agentName: co.others[0].name });
  const planReq = llm.requests.filter((q) => q.path === "/v1/chat/completions" && isPlan(systemOf(q))).at(-1)!;
  expect(userOf(planReq)).toContain(`id: ${co.others[0].id}`);
  expect(userOf(planReq)).toContain("Launch the bakery site");
  expect(await prisma.goalStep.count({ where: { goalId: g.gid, phase: "plan" } })).toBe(1);
});

test("a plan with an unknown assignee is repaired once; garbage twice fails clearly and can be replanned", async () => {
  const co = await company(app, llm);
  let n = 0;
  llm.setScript((s) => (isPlan(s) ? (++n === 1 ? fence(planFor(["nobody"])) : fence(planFor([co.nova.id]))) : "ok"));
  const g = await goal(co);
  expect((await waitFor(g.get, (x) => x.status !== "planning")).status).toBe("awaiting_approval");
  const repair = llm.requests.at(-1)!;
  expect(userOf(repair)).toMatch(/not on the roster/);
  await co.req("POST", `${g.base}/cancel`);

  llm.setScript((s) => (isPlan(s) ? "no idea" : "ok"));
  const bad = await goal(co, "Second goal");
  const failed = await waitFor(bad.get, (x) => x.status !== "planning");
  expect(failed).toMatchObject({ status: "failed", tasks: [] });
  expect(failed.error).toMatch(/Nova couldn't make a plan/);
  llm.setScript((s) => (isPlan(s) ? fence(planFor([co.nova.id])) : "ok"));
  expect((await co.req("POST", `${bad.base}/replan`)).statusCode).toBe(200);
  expect((await waitFor(bad.get, (x) => x.status !== "planning")).status).toBe("awaiting_approval");
});

test("plan editing validates; start needs models; start twice runs once; plan is locked after start", async () => {
  const co = await company(app, llm);
  const [a, b] = co.others;
  llm.setScript((s) => (isPlan(s) ? fence(planFor([a.id, b.id])) : "done"));
  const g = await goal(co);
  await waitFor(g.get, (x) => x.status === "awaiting_approval");
  const tasks = planFor([a.id, b.id]).tasks;
  expect((await co.req("PUT", `${g.base}/plan`, { tasks: [{ ...tasks[0], dependsOn: [1] }, { ...tasks[1], dependsOn: [0] }] })).statusCode).toBe(400);
  expect((await co.req("PUT", `${g.base}/plan`, { tasks: Array.from({ length: 7 }, () => tasks[0]) })).statusCode).toBe(400);
  expect((await co.req("PUT", `${g.base}/plan`, { tasks: [{ ...tasks[0], agentId: "someone-else" }] })).statusCode).toBe(400);
  expect((await co.req("PUT", `${g.base}/plan`, { tasks: [{ ...tasks[0], title: "Edited" }, tasks[1]] })).statusCode).toBe(200);
  expect((await g.get()).tasks[0].title).toBe("Edited");

  await co.req("PATCH", `/api/workspaces/${co.id}/agents/${b.id}`, { connectionId: null, model: null });
  const blocked = await co.req("POST", `${g.base}/start`);
  expect(blocked.statusCode).toBe(400);
  expect(blocked.json().error.message).toContain(`${b.name} has no AI model`);
  await co.req("PATCH", `/api/workspaces/${co.id}/agents/${b.id}`, { connectionId: co.cid, model: "fake-1" });

  const [s1, s2] = await Promise.all([co.req("POST", `${g.base}/start`), co.req("POST", `${g.base}/start`)]);
  expect([s1.statusCode, s2.statusCode].sort()).toEqual([200, 409]);
  expect((await co.req("PUT", `${g.base}/plan`, { tasks })).statusCode).toBe(409);
  expect((await g.get()).tasks[0].title).toBe("Edited");
});

test("one active goal per company; Nova needs a model; viewers read only; other companies get 404", async () => {
  const co = await company(app, llm);
  llm.setScript(async (s) => (isPlan(s) ? (await sleep(1500), fence(planFor([co.nova.id]))) : "ok"));
  const g = await goal(co);
  const second = await co.req("POST", `/api/workspaces/${co.id}/goals`, { text: "Another" });
  expect(second.statusCode).toBe(409);
  expect(second.json().error.message).toMatch(/Another goal is still in progress/);

  const viewer = await signUp(app);
  const vid = (await client(app, viewer.cookie)("GET", "/api/me")).json().user.id;
  await prisma.membership.create({ data: { workspaceId: co.id, userId: vid, role: "viewer" } });
  const vreq = client(app, viewer.cookie);
  expect((await vreq("GET", g.base)).statusCode).toBe(200);
  expect((await vreq("POST", `${g.base}/cancel`)).statusCode).toBe(403);
  const other = await company(app, llm);
  expect((await other.req("GET", `/api/workspaces/${other.id}/goals/${g.gid}`)).statusCode).toBe(404);
  expect((await other.req("GET", g.base)).statusCode).toBe(404);

  await co.req("POST", `${g.base}/cancel`);
  await co.req("PATCH", `/api/workspaces/${co.id}/agents/${co.nova.id}`, { connectionId: null, model: null });
  const noModel = await co.req("POST", `/api/workspaces/${co.id}/goals`, { text: "Third" });
  expect(noModel.statusCode).toBe(409);
  expect(noModel.json().error.message).toMatch(/Nova has no AI model/);
});

test("cancelling during planning wins over a late plan", async () => {
  const co = await company(app, llm);
  // The plan arrives well after Cancel, even at remote-database latency.
  llm.setScript(async (s) => (isPlan(s) ? (await sleep(10_000), fence(planFor([co.nova.id]))) : "ok"));
  const g = await goal(co);
  expect((await co.req("POST", `${g.base}/cancel`)).statusCode).toBe(200);
  await sleep(11_000);
  expect(await g.get()).toMatchObject({ status: "cancelled", tasks: [] });
  const list = (await co.req("GET", `/api/workspaces/${co.id}/goals`)).json().goals;
  expect(list[0]).toMatchObject({ id: g.gid, status: "cancelled", text: "Launch the bakery site" });
});
