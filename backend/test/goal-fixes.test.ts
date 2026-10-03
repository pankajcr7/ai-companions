import { afterAll, expect, test, vi } from "vitest";
import { prisma } from "../src/db.js";
import { recoverInterrupted } from "../src/goals/runner.js";
import { makeApp, ORIGIN } from "./helpers.js";
import { company, fakeLLM, fence, sleep, waitFor } from "./goal-helpers.js";
import { multipart } from "./upload-helpers.js";

// Each test builds whole companies at remote-database latency.
vi.setConfig({ testTimeout: 240_000 });
const llm = await fakeLLM();
const app = await makeApp();
afterAll(async () => {
  await llm.close();
  await app.close();
});

type Co = Awaited<ReturnType<typeof company>>;
const isPlan = (s: string) => s.includes("Turn the owner's goal into a plan");
const isSelect = (s: string) => s.includes("Pick the files you need to read");
const isReview = (s: string) => s.includes("Review each task result");
const oneTask = (agentId: string, title = "Only task") => fence({ tasks: [{ agentId, title, instructions: "Do it", deliverable: "A note", criteria: ["Clear"], dependsOn: [] }] });

async function planned(co: Co, text = "Fix pass goal", projectId?: string) {
  const gid = (await co.req("POST", `/api/workspaces/${co.id}/goals`, { text, projectId })).json().id as string;
  const base = `/api/workspaces/${co.id}/goals/${gid}`;
  const get = async () => (await co.req("GET", base)).json().goal;
  await waitFor(get, (g) => g.status === "awaiting_approval");
  return { gid, base, get };
}

test("a database error while loading a task fails that task instead of crashing the server", async () => {
  const co = await company(app, llm);
  llm.setScript((s) => (isPlan(s) ? oneTask(co.others[0].id) : isReview(s) ? fence({ summary: "Done.", verdicts: [] }) : "ok"));
  const g = await planned(co);
  const spy = vi.spyOn(prisma.goalTask, "findUniqueOrThrow").mockRejectedValueOnce(new Error("connection reset"));
  await co.req("POST", `${g.base}/start`);
  const final = await waitFor(g.get, (x) => x.status === "done" || x.status === "failed", 60_000);
  spy.mockRestore();
  expect(final.tasks[0]).toMatchObject({ status: "failed", errorCode: "server_error" });
});

test("a database error at the start of planning fails the goal instead of crashing the server", async () => {
  const co = await company(app, llm);
  llm.setScript((s) => (isPlan(s) ? oneTask(co.nova.id) : "ok"));
  const spy = vi.spyOn(prisma.goal, "findUniqueOrThrow").mockRejectedValueOnce(new Error("connection reset"));
  const gid = (await co.req("POST", `/api/workspaces/${co.id}/goals`, { text: "Planning fails" })).json().id as string;
  const base = `/api/workspaces/${co.id}/goals/${gid}`;
  const g = await waitFor(async () => (await co.req("GET", base)).json().goal, (x) => x.status !== "planning", 60_000);
  spy.mockRestore();
  expect(g).toMatchObject({ status: "failed" });
  expect(g.error).toMatch(/Nova couldn't make a plan/);
});

test("saving a plan waits for a Start that is already in progress, then refuses", async () => {
  const co = await company(app, llm);
  llm.setScript((s) => (isPlan(s) ? oneTask(co.others[0].id, "Original") : "ok"));
  const g = await planned(co);
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  // Stand in for Start: lock the goal row, move it to running, and hold the transaction open.
  const start = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Goal" WHERE id = ${g.gid} FOR UPDATE`;
      await tx.goal.update({ where: { id: g.gid }, data: { status: "running" } });
      await held;
    },
    { timeout: 60_000 },
  );
  await sleep(1500);
  const tasks = [{ agentId: co.others[0].id, title: "Replaced", instructions: "Other", deliverable: "Other", criteria: ["x"], dependsOn: [] }];
  const put = co.req("PUT", `${g.base}/plan`, { tasks });
  await sleep(4000);
  release();
  await start;
  expect((await put).statusCode).toBe(409);
  const rows = await prisma.goalTask.findMany({ where: { goalId: g.gid } });
  expect(rows.map((t) => t.title)).toEqual(["Original"]);
  await prisma.goal.update({ where: { id: g.gid }, data: { status: "cancelled" } });
});

test("applying the same change twice at once applies it once and keeps it marked applied", async () => {
  const co = await company(app, llm);
  const body = multipart({ name: `P${Math.random()}`, source: "folder" }, [["src/app.ts", "app.ts", "v1"]]);
  const pid = (await app.inject({ method: "POST", url: `/api/workspaces/${co.id}/projects/upload`, payload: body.payload, headers: { ...body.headers, cookie: co.cookie, origin: ORIGIN } })).json().projectId as string;
  llm.setScript((s) =>
    isPlan(s) ? oneTask(co.others[0].id) : isSelect(s) ? fence({ read: ["src/app.ts"] }) : isReview(s) ? fence({ summary: "ok", verdicts: [] }) : `Done.\n${fence({ edits: [{ path: "src/app.ts", content: "v2" }] })}`,
  );
  const g = await planned(co, "Edit once", pid);
  await co.req("POST", `${g.base}/start`);
  const done = await waitFor(g.get, (x) => x.status === "done");
  const eid = done.edits[0].id as string;
  const [a, b] = await Promise.all([co.req("POST", `${g.base}/edits/${eid}/apply`), co.req("POST", `${g.base}/edits/${eid}/apply`)]);
  expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
  expect((await g.get()).edits[0].status).toBe("applied");
  expect((await co.req("GET", `/api/workspaces/${co.id}/projects/${pid}/files?path=src/app.ts`)).json()).toMatchObject({ content: "v2", revision: 2 });
});

test("sending the same goal several times at once creates one goal", async () => {
  const co = await company(app, llm);
  llm.setScript(async (s) => (isPlan(s) ? (await sleep(3000), oneTask(co.nova.id)) : "ok"));
  const sends = await Promise.all(Array.from({ length: 4 }, () => co.req("POST", `/api/workspaces/${co.id}/goals`, { text: "Twice" })));
  expect(sends.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409]);
  expect(await prisma.goal.count({ where: { workspaceId: co.id } })).toBe(1);
});

test("after a restart, a running goal whose tasks hadn't started can be retried", async () => {
  const co = await company(app, llm);
  const me = (await co.req("GET", "/api/me")).json().user.id as string;
  const goal = await prisma.goal.create({ data: { workspaceId: co.id, text: "Between ticks", status: "running", createdById: me } });
  const task = await prisma.goalTask.create({ data: { goalId: goal.id, agentId: co.others[0].id, position: 0, title: "t", instructions: "i", deliverable: "d", criteria: ["c"], dependsOn: [], status: "pending" } });
  await recoverInterrupted();
  expect(await prisma.goalTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: "interrupted" });
  llm.setScript((s) => (isReview(s) ? fence({ summary: "Back.", verdicts: [] }) : "resumed"));
  const base = `/api/workspaces/${co.id}/goals/${goal.id}`;
  expect((await co.req("POST", `${base}/tasks/${task.id}/retry`)).statusCode).toBe(200);
  const final = await waitFor(async () => (await co.req("GET", base)).json().goal, (x) => x.status === "done");
  expect(final.tasks[0]).toMatchObject({ status: "done", result: "resumed" });
});
