import { afterAll, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { client, makeApp, signUp } from "./helpers.js";

const app = await makeApp();
afterAll(() => app.close());

async function company(req: ReturnType<typeof client>, name: string) {
  const id = (await req("POST", "/api/workspaces", { name, template: "starter" })).json().id as string;
  const snap = (await req("GET", `/api/workspaces/${id}`)).json();
  return { id, agents: snap.agents as { id: string; isHead: boolean }[] };
}

test("a companion's recent work: finished tasks only, newest first, limited", async () => {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const co = await company(req, "Tasks Co");
  const me = (await req("GET", "/api/me")).json().user.id as string;
  const agent = co.agents.find((a) => !a.isHead)!;
  const goal = await prisma.goal.create({ data: { workspaceId: co.id, text: "Launch the shop", createdById: me, status: "done" } });
  const t0 = Date.now() - 100_000;
  await prisma.goalTask.createMany({
    data: [
      ...Array.from({ length: 7 }, (_, i) => ({ goalId: goal.id, agentId: agent.id, position: i, title: `Task ${i}`, instructions: "i", deliverable: "d", status: "done" as const, finishedAt: new Date(t0 + i * 1000) })),
      { goalId: goal.id, agentId: agent.id, position: 7, title: "Still going", instructions: "i", deliverable: "d", status: "running" as const },
      { goalId: goal.id, agentId: co.agents.find((a) => a.isHead)!.id, position: 8, title: "Someone else", instructions: "i", deliverable: "d", status: "done" as const, finishedAt: new Date() },
    ],
  });

  const res = await req("GET", `/api/workspaces/${co.id}/agents/${agent.id}/tasks`);
  expect(res.statusCode).toBe(200);
  expect(res.json().tasks.map((t: { title: string }) => t.title)).toEqual(["Task 6", "Task 5", "Task 4", "Task 3", "Task 2"]);
  expect(res.json().tasks[0]).toMatchObject({ goalId: goal.id, goalText: "Launch the shop" });
  const two = await req("GET", `/api/workspaces/${co.id}/agents/${agent.id}/tasks?limit=2`);
  expect(two.json().tasks).toHaveLength(2);
  expect((await req("GET", `/api/workspaces/${co.id}/agents/${agent.id}/tasks?limit=50`)).statusCode).toBe(400);
});

test("another company's companion is not found", async () => {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const a = await company(req, "Alpha Co");
  const b = await company(req, "Beta Co");
  const res = await req("GET", `/api/workspaces/${b.id}/agents/${a.agents[0].id}/tasks`);
  expect(res.statusCode).toBe(404);
});
