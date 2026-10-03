import { afterAll, expect, test, vi } from "vitest";
import { makeApp } from "./helpers.js";
import { company, fakeLLM, fence, sleep, waitFor } from "./goal-helpers.js";

vi.setConfig({ testTimeout: 240_000 });
const llm = await fakeLLM();
const app = await makeApp();
afterAll(async () => {
  await llm.close();
  await app.close();
});

const isPlan = (s: string) => s.includes("Turn the owner's goal into a plan");
const isReview = (s: string) => s.includes("Review each task result");

test("a stopped goal resumes its unfinished tasks and keeps finished ones", async () => {
  const co = await company(app, llm);
  const [a, b] = co.others;
  let slow = true;
  llm.setScript(async (s, u) => {
    if (isPlan(s)) return fence({ tasks: [{ agentId: a.id, title: "Quick", instructions: "q", deliverable: "d", criteria: ["c"], dependsOn: [] }, { agentId: b.id, title: "Slow", instructions: "s", deliverable: "d", criteria: ["c"], dependsOn: [0] }] });
    if (isReview(s)) return fence({ summary: "All done.", verdicts: [] });
    if (u.includes("YOUR TASK:\nSlow") && slow) return (await sleep(8000), "late");
    return u.includes("YOUR TASK:\nSlow") ? "slow result" : "quick result";
  });
  const gid = (await co.req("POST", `/api/workspaces/${co.id}/goals`, { text: "Two steps" })).json().id as string;
  const base = `/api/workspaces/${co.id}/goals/${gid}`;
  const get = async () => (await co.req("GET", base)).json().goal;
  await waitFor(get, (g) => g.status === "awaiting_approval");
  await co.req("POST", `${base}/start`);
  const working = await waitFor(get, (g) => g.tasks[1].status === "running");
  expect(working.tasks[1].startedAt).toBeTruthy();
  await co.req("POST", `${base}/cancel`);
  const stopped = await waitFor(get, (g) => g.status === "cancelled");
  expect(stopped.tasks.map((t: { status: string }) => t.status)).toEqual(["done", "skipped"]);
  slow = false;
  expect((await co.req("POST", `${base}/resume`)).statusCode).toBe(200);
  const done = await waitFor(get, (g) => g.status === "done");
  expect(done.tasks.map((t: { status: string; result: string }) => [t.status, t.result])).toEqual([
    ["done", "quick result"],
    ["done", "slow result"],
  ]);
  expect(done.summary).toBe("All done.");
});

test("resume refuses a plan that was never started, and goals that aren't stopped", async () => {
  const co = await company(app, llm);
  llm.setScript((s) => (isPlan(s) ? fence({ tasks: [{ agentId: co.nova.id, title: "t", instructions: "i", deliverable: "d", criteria: ["c"], dependsOn: [] }] }) : "ok"));
  const gid = (await co.req("POST", `/api/workspaces/${co.id}/goals`, { text: "Never started" })).json().id as string;
  const base = `/api/workspaces/${co.id}/goals/${gid}`;
  await waitFor(async () => (await co.req("GET", base)).json().goal, (g) => g.status === "awaiting_approval");
  expect((await co.req("POST", `${base}/resume`)).statusCode).toBe(409);
  await co.req("POST", `${base}/cancel`);
  const res = await co.req("POST", `${base}/resume`);
  expect(res.statusCode).toBe(409);
  expect(res.json().error.message).toBe("This plan was never started. Ask Nova again to make a new plan.");
});
