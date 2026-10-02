import { afterAll, expect, test, vi } from "vitest";
import { prisma } from "../src/db.js";
import { recoverInterrupted } from "../src/goals/runner.js";
import { makeApp, ORIGIN } from "./helpers.js";
import { company, fakeLLM, fence, sleep, systemOf, userOf, waitFor, type Script } from "./goal-helpers.js";
import { multipart } from "./upload-helpers.js";

// Each test builds whole companies at remote-database latency.
vi.setConfig({ testTimeout: 240_000 });
const llm = await fakeLLM();
const app = await makeApp();
afterAll(async () => {
  await llm.close();
  await app.close();
});

type T = { agentId: string; title: string; dependsOn?: number[] };
const plan = (tasks: T[]) => fence({ tasks: tasks.map((t) => ({ instructions: `Do ${t.title}`, deliverable: "A note", criteria: ["Clear"], dependsOn: [], ...t })) });
const isPlan = (s: string) => s.includes("Turn the owner's goal into a plan");
const isSelect = (s: string) => s.includes("Pick the files you need to read");
const isTask = (s: string) => s.includes("Nova assigned you a task");
const isReview = (s: string) => s.includes("Review each task result");
const review = (n: number) => fence({ summary: "All good.", verdicts: Array.from({ length: n }, (_, position) => ({ position, verdict: position === 0 ? "meets" : "needs_eyes", note: `n${position}` })) });
const done = (s: string) => ["done", "failed", "cancelled"].includes(s);

async function run(co: Awaited<ReturnType<typeof company>>, script: Script, projectId?: string) {
  llm.setScript(script);
  const gid = (await co.req("POST", `/api/workspaces/${co.id}/goals`, { text: "Launch it", projectId })).json().id as string;
  const base = `/api/workspaces/${co.id}/goals/${gid}`;
  const get = async () => (await co.req("GET", base)).json().goal;
  await waitFor(get, (g) => g.status === "awaiting_approval");
  expect((await co.req("POST", `${base}/start`)).statusCode).toBe(200);
  return { gid, base, get };
}

async function project(co: Awaited<ReturnType<typeof company>>, files: [string, string][]) {
  const body = multipart({ name: `P${Math.random()}`, source: "folder" }, files.map(([p, c]) => [p, p.split("/").pop()!, c]));
  return (await app.inject({ method: "POST", url: `/api/workspaces/${co.id}/projects/upload`, payload: body.payload, headers: { ...body.headers, cookie: co.cookie, origin: ORIGIN } })).json().projectId as string;
}

test("tasks run in dependency order, see earlier results, and Nova reviews them", async () => {
  const co = await company(app, llm);
  const [a, b] = co.others;
  const g = await run(co, (s, u) => (isPlan(s) ? plan([{ agentId: a.id, title: "first" }, { agentId: b.id, title: "second", dependsOn: [0] }]) : isReview(s) ? review(2) : isTask(s) ? `RESULT for ${u.includes("YOUR TASK:\nfirst") ? "first" : "second"}` : "?"));
  const final = await waitFor(g.get, (x) => done(x.status));
  expect(final.status).toBe("done");
  expect(final.summary).toBe("All good.");
  expect(final.tasks.map((t: { status: string; result: string; verdict: string }) => [t.status, t.result, t.verdict])).toEqual([
    ["done", "RESULT for first", "meets"],
    ["done", "RESULT for second", "needs_eyes"],
  ]);
  const second = llm.requests.filter((q) => isTask(systemOf(q))).find((q) => userOf(q).includes("YOUR TASK:\nsecond"))!;
  expect(userOf(second)).toContain("RESULTS YOU BUILD ON:\n### first");
  expect(userOf(second)).toContain("RESULT for first");
  expect(systemOf(second)).toContain(`You are ${b.name}`);
  expect(final.inputTokens).toBeGreaterThan(0);
  const phases = (await prisma.goalStep.findMany({ where: { goalId: g.gid } })).map((s) => s.phase).sort();
  expect(phases).toEqual(["execute", "execute", "plan", "summary"]);
});

test("at most 3 tasks run at once", async () => {
  const co = await company(app, llm);
  let inFlight = 0;
  let peak = 0;
  const g = await run(co, async (s) => {
    if (isPlan(s)) return plan(Array.from({ length: 5 }, (_, i) => ({ agentId: co.others[i % co.others.length].id, title: `t${i}` })));
    if (isReview(s)) return review(5);
    inFlight++;
    peak = Math.max(peak, inFlight);
    await sleep(1200);
    inFlight--;
    return "ok";
  });
  await waitFor(g.get, (x) => done(x.status));
  expect(peak).toBe(3);
});

test("a failed task skips its dependents; retry runs them; a paused companion fails with a clear reason", async () => {
  const co = await company(app, llm);
  const [a, b, c] = co.others;
  let failFirst = true;
  const g = await run(co, (s, u) => {
    if (isPlan(s)) return plan([{ agentId: a.id, title: "base" }, { agentId: b.id, title: "builds", dependsOn: [0] }, { agentId: c.id, title: "solo" }]);
    if (isReview(s)) return review(3);
    if (u.includes("YOUR TASK:\nbase") && failFirst) return { status: 401, message: "bad key" };
    return "fine";
  });
  let g1 = await waitFor(g.get, (x) => done(x.status));
  expect(g1.tasks.map((t: { status: string }) => t.status)).toEqual(["failed", "skipped", "done"]);
  expect(g1.tasks[0]).toMatchObject({ errorCode: "auth" });
  failFirst = false;
  expect((await co.req("POST", `${g.base}/tasks/${g1.tasks[0].id}/retry`)).statusCode).toBe(200);
  g1 = await waitFor(g.get, (x) => done(x.status) && x.tasks[1].status !== "pending");
  expect(g1.tasks.map((t: { status: string }) => t.status)).toEqual(["done", "done", "done"]);

  // The second task's companion is paused while the first task is still working.
  const co2 = await company(app, llm);
  const [p, q] = co2.others;
  const g2 = await run(co2, async (s, u) =>
    isPlan(s) ? plan([{ agentId: p.id, title: "x" }, { agentId: q.id, title: "y", dependsOn: [0] }, { agentId: p.id, title: "z", dependsOn: [1] }]) : isReview(s) ? review(3) : u.includes("YOUR TASK:\nx") ? (await sleep(2500), "ok") : "ok",
  );
  await co2.req("PATCH", `/api/workspaces/${co2.id}/agents/${q.id}`, { status: "paused" });
  const paused = await waitFor(g2.get, (x) => done(x.status));
  expect(paused.tasks.map((t: { status: string }) => t.status)).toEqual(["done", "failed", "skipped"]);
  expect(paused.tasks[1].error).toBe(`${q.name} is paused`);
});

test("project files: unknown paths dropped, budget respected, read files recorded, brief and brand first", async () => {
  const co = await company(app, llm);
  const pid = await project(co, [["README.md", "# Crumb"], ["big.txt", "x".repeat(70_000)], [".company/brief.md", "BRIEF-TEXT"], [".company/brand.md", "BRAND-TEXT"], ["src/app.ts", "export {}"]]);
  const g = await run(
    co,
    (s) => (isPlan(s) ? plan([{ agentId: co.others[0].id, title: "read" }]) : isSelect(s) ? fence({ read: ["README.md", "nope.txt", "big.txt"] }) : isReview(s) ? review(1) : "read it"),
    pid,
  );
  const final = await waitFor(g.get, (x) => done(x.status));
  expect(final.tasks[0].filesRead).toEqual([{ path: "README.md", revision: 1 }]);
  const exec = llm.requests.filter((q) => isTask(systemOf(q))).at(-1)!;
  expect(userOf(exec).startsWith("SHARED BRIEF AND BRAND:\n## .company/brief.md\nBRIEF-TEXT")).toBe(true);
  expect(userOf(exec)).toContain('<file path="README.md">\n# Crumb');
  expect(userOf(exec)).not.toContain("xxxxxxxxxx");
  expect(userOf(exec)).toContain("NOTE:");
  const planReq = llm.requests.filter((q) => isPlan(systemOf(q))).at(-1)!;
  expect(userOf(planReq)).toContain("BRAND-TEXT");
  const row = await prisma.goalTask.findFirstOrThrow({ where: { goalId: g.gid } });
  expect(row.contextRevisions).toEqual({ ".company/brief.md": 1, ".company/brand.md": 1 });
});

test("proposed edits are stored and checked; the edits block is hidden from the result", async () => {
  const co = await company(app, llm);
  const pid = await project(co, [["src/app.ts", "const a = 1;"], ["other.ts", "o"]]);
  const edits = [
    { path: "src/app.ts", content: "const a = 2;", note: "bump" },
    { path: ".env", content: "S=1" },
    { path: "other.ts", content: "changed" },
    { path: "docs/new.md", content: "# New" },
  ];
  const g = await run(co, (s) => (isPlan(s) ? plan([{ agentId: co.others[0].id, title: "edit" }]) : isSelect(s) ? fence({ read: ["src/app.ts"] }) : isReview(s) ? review(1) : `Changed it.\n\n${fence({ edits })}`), pid);
  const final = await waitFor(g.get, (x) => done(x.status));
  expect(final.tasks[0].result).toBe("Changed it.");
  expect(final.edits.map((e: { path: string; baseRevision: number; status: string; reason: string | null }) => [e.path, e.baseRevision, e.status, e.reason])).toEqual([
    ["src/app.ts", 1, "pending", null],
    [".env", 0, "rejected", "secret or credential file"],
    ["other.ts", 0, "rejected", "the companion didn't read this file"],
    ["docs/new.md", 0, "pending", null],
  ]);
});

test("a rambling reply is capped; cancel stops running tasks", async () => {
  const co = await company(app, llm);
  const g = await run(co, (s) => (isPlan(s) ? plan([{ agentId: co.others[0].id, title: "long" }]) : isReview(s) ? review(1) : "y".repeat(60_000)));
  const final = await waitFor(g.get, (x) => done(x.status));
  expect(final.status).toBe("done");
  expect(final.tasks[0].result.length).toBeLessThan(50_100);
  expect(final.tasks[0].result).toMatch(/\[truncated: the result is longer than 50000 characters\]$/);

  const g2 = await run(co, async (s) => (isPlan(s) ? plan([{ agentId: co.others[0].id, title: "slow" }]) : isReview(s) ? review(1) : (await sleep(8000), "late")));
  await waitFor(g2.get, (x) => x.tasks[0].status === "running");
  expect((await co.req("POST", `${g2.base}/cancel`)).statusCode).toBe(200);
  await sleep(1500);
  const cancelled = await g2.get();
  expect(cancelled.status).toBe("cancelled");
  expect(cancelled.tasks[0]).toMatchObject({ status: "skipped", result: null });
  expect(cancelled.summary).toBeNull();
});

test("restart recovery marks running work interrupted, and retry resumes it", async () => {
  const co = await company(app, llm);
  const goal = await prisma.goal.create({ data: { workspaceId: co.id, text: "Recover", status: "running", createdById: (await co.req("GET", "/api/me")).json().user.id } });
  const task = await prisma.goalTask.create({ data: { goalId: goal.id, agentId: co.others[0].id, position: 0, title: "t", instructions: "i", deliverable: "d", criteria: ["c"], dependsOn: [], status: "running" } });
  await recoverInterrupted();
  expect(await prisma.goalTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: "interrupted" });
  expect(await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } })).toMatchObject({ status: "failed", error: "Interrupted by a server restart." });
  llm.setScript((s) => (isReview(s) ? review(1) : "resumed"));
  const base = `/api/workspaces/${co.id}/goals/${goal.id}`;
  expect((await co.req("POST", `${base}/tasks/${task.id}/retry`)).statusCode).toBe(200);
  const final = await waitFor(async () => (await co.req("GET", base)).json().goal, (x) => done(x.status));
  expect(final).toMatchObject({ status: "done", tasks: [{ status: "done", result: "resumed" }] });
  const rate = await co.req("POST", `${base}/tasks/${task.id}/rating`, { rating: -1, reason: "too generic" });
  expect(rate.statusCode).toBe(200);
  expect(await prisma.goalTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ rating: -1, ratingReason: "too generic" });
});
