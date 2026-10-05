import { afterAll, expect, test, vi } from "vitest";
import { makeApp } from "./helpers.js";
import { company, fakeLLM, fence, sleep, waitFor } from "./goal-helpers.js";

vi.setConfig({ testTimeout: 240_000 });
const llm = await fakeLLM();
const app = await makeApp();
afterAll(async () => {
  await llm.close();
  await app.close();
  delete process.env.TASK_TIME_LIMIT_MS;
});

test("a task that runs past the time limit is marked as timed out, not cancelled", async () => {
  process.env.TASK_TIME_LIMIT_MS = "4000";
  const co = await company(app, llm);
  llm.setScript(async (s) => {
    if (s.includes("Turn the owner's goal into a plan")) return fence({ tasks: [{ agentId: co.others[0].id, title: "Slow work", instructions: "i", deliverable: "d", criteria: ["c"], dependsOn: [] }] });
    if (s.includes("Nova assigned you a task")) return (await sleep(9000), "too late");
    if (s.includes("Review each task result")) return fence({ summary: "ok", verdicts: [] });
    return "ok";
  });
  const gid = (await co.req("POST", `/api/workspaces/${co.id}/goals`, { text: "Do slow work" })).json().id as string;
  const base = `/api/workspaces/${co.id}/goals/${gid}`;
  const get = async () => (await co.req("GET", base)).json().goal;
  await waitFor(get, (g) => g.status === "awaiting_approval");
  await co.req("POST", `${base}/start`);
  const done = await waitFor(get, (g) => g.tasks[0].status !== "running" && g.tasks[0].status !== "pending");
  expect(done.tasks[0]).toMatchObject({ status: "failed", errorCode: "timeout" });
  expect(done.tasks[0].error).toMatch(/took longer than/i);
  expect(done.tasks[0].error).not.toMatch(/cancel/i);
});
