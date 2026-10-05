import { afterAll, expect, test, vi } from "vitest";
import { prisma } from "../src/db.js";
import { makeApp } from "./helpers.js";
import { company, fakeLLM, fence, systemOf, userOf, waitFor } from "./goal-helpers.js";

vi.setConfig({ testTimeout: 240_000 });
const llm = await fakeLLM();
const app = await makeApp();
afterAll(async () => {
  await llm.close();
  await app.close();
});
const isPlan = (s: string) => s.includes("Turn the owner's goal into a plan");
const isTask = (s: string) => s.includes("Nova assigned you a task");
const BRIEF = "Audience: busy parents. Feel: warm, handmade. Colours: cream and brown. Don't: gradients, emoji.";
type Co = Awaited<ReturnType<typeof company>>;
const script = (co: Co, brief: string | undefined, extra: object = {}) =>
  llm.setScript((s) => (isPlan(s) ? fence({ ...extra, ...(brief ? { brief } : {}), tasks: [{ agentId: co.others[0].id, title: "Build the page", instructions: "i", deliverable: "d", criteria: ["c"], dependsOn: [] }] }) : s.includes("Review each task result") ? fence({ summary: "ok", verdicts: [] }) : s.includes("Pick the files") ? fence({ read: [] }) : "Done."));
async function plan(co: Co, body: object) {
  const gid = (await co.req("POST", `/api/workspaces/${co.id}/goals`, body)).json().id as string;
  const base = `/api/workspaces/${co.id}/goals/${gid}`;
  const get = async () => (await co.req("GET", base)).json().goal;
  return { base, get, planned: await waitFor(get, (g) => g.status === "awaiting_approval") };
}

test("a new-project goal's brief is shown, saved to .company/brief.md on Start, and given to every task", async () => {
  const co = await company(app, llm);
  script(co, BRIEF, { projectName: "Bakery" });
  const g = await plan(co, { text: "Build a bakery site", newProject: true });
  expect(g.planned.brief).toBe(BRIEF);
  await co.req("POST", `${g.base}/start`);
  const done = await waitFor(g.get, (x) => x.status === "done" || x.status === "failed");
  const entry = await prisma.projectEntry.findFirstOrThrow({ where: { projectId: done.projectId, pathLower: ".company/brief.md" } });
  expect(entry.revision).toBe(1);
  const taskReq = llm.requests.filter((q) => isTask(systemOf(q))).at(-1)!;
  // Saved as the project brief, it reaches the task once (as the shared brief), not twice.
  expect(userOf(taskReq).split(BRIEF).length - 1).toBe(1);
});

test("an existing project with a brief gets Nova's brief as a suggestion; the owner can clear it before Start", async () => {
  const co = await company(app, llm);
  const pid = (await co.req("POST", `/api/workspaces/${co.id}/projects`, { name: "Shop" })).json().id as string;
  await co.req("PUT", `/api/workspaces/${co.id}/projects/${pid}/files`, { path: ".company/brief.md", content: "Old brief", baseRevision: 0 });
  script(co, BRIEF);
  const g = await plan(co, { text: "Refresh the shop", projectId: pid });
  await co.req("POST", `${g.base}/start`);
  const done = await waitFor(g.get, (x) => x.status === "done" || x.status === "failed");
  expect(done.edits.filter((e: { path: string }) => e.path === ".company/brief.md")).toMatchObject([{ status: "pending", baseRevision: 1 }]);

  const g2 = await plan(co, { text: "Another change", projectId: pid });
  const tasks = g2.planned.tasks.map((t: Record<string, unknown>) => ({ agentId: t.agentId, title: t.title, instructions: t.instructions, deliverable: t.deliverable, criteria: t.criteria, dependsOn: t.dependsOn }));
  expect((await co.req("PUT", `${g2.base}/plan`, { tasks, brief: null })).statusCode).toBe(200);
  expect((await g2.get()).brief).toBeNull();
});
