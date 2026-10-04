import { afterAll, expect, test, vi } from "vitest";
import { prisma } from "../src/db.js";
import { makeApp } from "./helpers.js";
import { company, fakeLLM, fence, sleep, systemOf, waitFor } from "./goal-helpers.js";

vi.setConfig({ testTimeout: 240_000 });
const llm = await fakeLLM();
const app = await makeApp();
afterAll(async () => {
  await llm.close();
  await app.close();
});

const isPlan = (s: string) => s.includes("Turn the owner's goal into a plan");
const isSelect = (s: string) => s.includes("Pick the files you need to read");
const isTask = (s: string) => s.includes("Nova assigned you a task");
const isReview = (s: string) => s.includes("Review each task result");
const task = (agentId: string, title: string) => ({ agentId, title, instructions: "i", deliverable: "d", criteria: ["c"], dependsOn: [] });
const tool = (name: string, args: object) => fence({ tool: name, args });
type Co = Awaited<ReturnType<typeof company>>;

async function withProject(co: Co) {
  const pid = (await co.req("POST", `/api/workspaces/${co.id}/projects`, { name: "Shop" })).json().id as string;
  await co.req("PUT", `/api/workspaces/${co.id}/projects/${pid}/files`, { path: "README.md", content: "# Shop\nSells bread.\n", baseRevision: 0 });
  return pid;
}
async function start(co: Co, body: object) {
  const gid = (await co.req("POST", `/api/workspaces/${co.id}/goals`, body)).json().id as string;
  const base = `/api/workspaces/${co.id}/goals/${gid}`;
  const get = async () => (await co.req("GET", base)).json().goal;
  await waitFor(get, (g) => g.status === "awaiting_approval");
  await co.req("POST", `${base}/start`);
  return { gid, base, get };
}

test("a task lists, reads, and writes: existing files become suggestions, new ones too, and activity is recorded", async () => {
  const co = await company(app, llm);
  const pid = await withProject(co);
  let round = 0;
  llm.setScript((s, u) => {
    if (isPlan(s)) return fence({ tasks: [task(co.others[0].id, "Update the readme")] });
    if (isSelect(s)) return fence({ read: [] });
    if (isReview(s)) return fence({ summary: "ok", verdicts: [] });
    if (isTask(s)) {
      round++;
      if (round === 1) return tool("list_files", {});
      if (round === 2) return tool("read_file", { path: "README.md" });
      if (round === 3) return u.includes("Sells bread.") ? tool("write_file", { path: "README.md", content: "# Shop\nSells bread and cakes.\n", note: "Add cakes" }) : "missing";
      if (round === 4) return tool("write_file", { path: "CHANGELOG.md", content: "- cakes\n" });
      return "Updated the readme.";
    }
    return "ok";
  });
  const g = await start(co, { text: "Update the readme", projectId: pid });
  const done = await waitFor(g.get, (x) => x.status === "done" || x.status === "failed");
  expect(done.tasks[0]).toMatchObject({ status: "done", result: "Updated the readme." });
  expect(done.tasks[0].toolUses.map((u: { name: string }) => u.name)).toEqual(["list_files", "read_file", "write_file", "write_file"]);
  expect(done.tasks[0].filesRead).toEqual([{ path: "README.md", revision: 1 }]);
  expect(done.edits.map((e: { path: string; status: string; baseRevision: number }) => [e.path, e.status, e.baseRevision]).sort()).toEqual([["CHANGELOG.md", "pending", 0], ["README.md", "pending", 1]]);
  const tool3 = llm.requests.filter((q) => isTask(systemOf(q))).at(3)!;
  expect(JSON.stringify(tool3.body)).toContain("Saved as a suggestion for the owner to review.");
});

test("a goal that builds a new project saves new files at once through write_file", async () => {
  const co = await company(app, llm);
  let round = 0;
  llm.setScript((s) => {
    if (isPlan(s)) return fence({ projectName: "Bakery", tasks: [task(co.others[0].id, "Build")] });
    if (isSelect(s)) return fence({ read: [] });
    if (isReview(s)) return fence({ summary: "ok", verdicts: [] });
    if (isTask(s)) return ++round === 1 ? tool("write_file", { path: "index.html", content: "<h1>Bakery</h1>" }) : "Built.";
    return "ok";
  });
  const g = await start(co, { text: "Build a site", newProject: true });
  const done = await waitFor(g.get, (x) => x.status === "done" || x.status === "failed");
  expect(done.edits).toMatchObject([{ path: "index.html", status: "applied" }]);
  expect(await prisma.projectEntry.count({ where: { projectId: done.projectId, path: "index.html" } })).toBe(1);
});

test("planning can read the project before planning", async () => {
  const co = await company(app, llm);
  const pid = await withProject(co);
  let planRound = 0;
  llm.setScript((s, u) => {
    if (isPlan(s)) return ++planRound === 1 ? tool("read_file", { path: "README.md" }) : u.includes("Sells bread.") ? fence({ tasks: [task(co.nova.id, "Plan from readme")] }) : "no";
    return "ok";
  });
  const gid = (await co.req("POST", `/api/workspaces/${co.id}/goals`, { text: "Improve the shop", projectId: pid })).json().id as string;
  const g = await waitFor(async () => (await co.req("GET", `/api/workspaces/${co.id}/goals/${gid}`)).json().goal, (x) => x.status === "awaiting_approval" || x.status === "failed");
  expect(g.tasks.map((t: { title: string }) => t.title)).toEqual(["Plan from readme"]);
});

test("Stop during a tool loop ends the task as cancelled and saves nothing more", async () => {
  const co = await company(app, llm);
  let round = 0;
  llm.setScript(async (s) => {
    if (isPlan(s)) return fence({ projectName: "Slow", tasks: [task(co.others[0].id, "Build slowly")] });
    if (isSelect(s)) return fence({ read: [] });
    if (isTask(s)) {
      round++;
      if (round === 1) return tool("list_files", {});
      await sleep(8000);
      return tool("write_file", { path: "late.html", content: "late" });
    }
    return "ok";
  });
  const g = await start(co, { text: "Build", newProject: true });
  await waitFor(async () => round, (r) => r >= 2, 60_000);
  await co.req("POST", `${g.base}/cancel`);
  await sleep(10_000);
  const after = await g.get();
  expect(after.status).toBe("cancelled");
  expect(after.tasks[0].status).toBe("skipped");
  expect(await prisma.projectEntry.count({ where: { path: "late.html" } })).toBe(0);
});
