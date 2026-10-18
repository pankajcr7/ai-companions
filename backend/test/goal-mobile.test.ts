import { afterAll, expect, test, vi } from "vitest";
import { makeApp } from "./helpers.js";
import { company, fakeLLM, fence, systemOf, userOf, waitFor } from "./goal-helpers.js";

// Each test builds whole companies at remote-database latency.
vi.setConfig({ testTimeout: 240_000 });
const llm = await fakeLLM();
const app = await makeApp();
afterAll(async () => {
  await llm.close();
  await app.close();
});

const isPlan = (s: string) => s.includes("Turn the owner's goal into a plan");
const isTask = (s: string) => s.includes("Nova assigned you a task");
const isReview = (s: string) => s.includes("Review a teammate's finished task");
const isSummary = (s: string) => s.includes("Review each task result");

/** Runs a one-task goal with Nova's check on and returns the instructions each step was sent. */
async function run(text: string) {
  const co = await company(app, llm, "starter", { qualityChecks: true });
  llm.setScript((s) => {
    if (isPlan(s)) return fence({ projectName: "Trail", tasks: [{ agentId: co.others[0].id, title: "The look and the screen list", instructions: "Plan the look.", deliverable: "design/identity.md", criteria: ["c"], dependsOn: [] }] });
    if (isReview(s)) return fence({ approved: true, fixes: [] });
    if (isSummary(s)) return fence({ summary: "Done.", verdicts: [] });
    if (isTask(s)) return "Done.";
    return "ok";
  });
  const sent = llm.requests.length;
  const gid = (await co.req("POST", `/api/workspaces/${co.id}/goals`, { text, newProject: true })).json().id as string;
  const get = async () => (await co.req("GET", `/api/workspaces/${co.id}/goals/${gid}`)).json().goal;
  await waitFor(get, (g) => g.status === "awaiting_approval");
  expect((await co.req("POST", `/api/workspaces/${co.id}/goals/${gid}/start`)).statusCode).toBe(200);
  expect((await waitFor(get, (g) => g.status === "done" || g.status === "failed")).status).toBe("done");
  const calls = llm.requests.slice(sent).filter((q) => q.path === "/v1/chat/completions");
  const of = (is: (s: string) => boolean) => calls.filter((q) => is(systemOf(q)));
  return { plan: of(isPlan).map(systemOf).join("\n"), task: of(isTask).map(systemOf).join("\n"), review: of(isReview).map(userOf).join("\n") };
}

test("a mobile design goal plans the look first and its tasks and review get the screen guide", async () => {
  const r = await run("Design a mobile app for a hiking club");
  expect(r.plan).toContain("MOBILE APP DESIGN:");
  expect(r.task).toContain("MOBILE SCREEN GUIDE");
  expect(r.review).toContain("MOBILE SCREEN GUIDE");
});

test("an ordinary goal gets none of the mobile texts", async () => {
  const r = await run("Build a landing page for a hiking club");
  expect(r.plan).not.toContain("MOBILE APP DESIGN:");
  expect(r.task).not.toContain("MOBILE SCREEN GUIDE");
  expect(r.review).not.toContain("MOBILE SCREEN GUIDE");
});
