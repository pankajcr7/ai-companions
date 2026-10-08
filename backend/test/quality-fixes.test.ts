import { afterAll, expect, test, vi } from "vitest";
import { prisma } from "../src/db.js";
import { planInstructions } from "../src/goals/prompts.js";
import { projectTools } from "../src/harness/tools.js";
import { ToolError } from "../src/harness/loop.js";
import { saveText } from "../src/files/service.js";
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
const isCheck = (s: string) => s.includes("Review a teammate's finished task");
const isSummary = (s: string) => s.includes("Review each task result");
type Co = Awaited<ReturnType<typeof company>>;
const planOne = (co: Co, title = "Build the landing page") => fence({ tasks: [{ agentId: co.others[0].id, title, instructions: "Make index.html", deliverable: "The page", criteria: ["Has pricing"], dependsOn: [] }] });
async function run(co: Co, body: object) {
  const gid = (await co.req("POST", `/api/workspaces/${co.id}/goals`, body)).json().id as string;
  const base = `/api/workspaces/${co.id}/goals/${gid}`;
  const get = async () => (await co.req("GET", base)).json().goal;
  await waitFor(get, (g) => g.status === "awaiting_approval");
  await co.req("POST", `${base}/start`);
  return waitFor(get, (g) => g.status === "done" || g.status === "failed");
}

test("a review call that fails (rate limit, server error) is skipped: the finished task stays done with its result", async () => {
  const co = await company(app, llm, "starter", { qualityChecks: true });
  llm.setScript((s) => (isPlan(s) ? planOne(co) : isCheck(s) ? { status: 500, message: "overloaded" } : isSummary(s) ? fence({ summary: "ok", verdicts: [] }) : isTask(s) ? "Done." : "ok"));
  const done = await run(co, { text: "Build a page" });
  expect(done.tasks[0]).toMatchObject({ status: "done", result: "Done.", review: null });
});

test("Nova's summary never turns a 'needs your eyes' from the review into 'meets'", async () => {
  const co = await company(app, llm, "starter", { qualityChecks: true });
  llm.setScript((s, u) => (isPlan(s) ? planOne(co) : isCheck(s) ? fence({ approved: false, fixes: ["Still missing pricing."] }) : isSummary(s) ? fence({ summary: "ok", verdicts: [{ position: 0, verdict: "meets", note: "fine" }] }) : isTask(s) ? (u.startsWith("NOVA'S REVIEW") ? "Tried." : "First.") : "ok"));
  const done = await run(co, { text: "Build a page" });
  expect(done.tasks[0]).toMatchObject({ verdict: "needs_eyes", verdictNote: "Nova asked for more changes after 2 rounds." });
});

test("a revision that rewrites a file replaces the earlier version: one suggestion per file, and Nova reviews the latest", async () => {
  const co = await company(app, llm, "starter", { qualityChecks: true });
  const pid = (await co.req("POST", `/api/workspaces/${co.id}/projects`, { name: "Shop" })).json().id as string;
  await co.req("PUT", `/api/workspaces/${co.id}/projects/${pid}/files`, { path: "index.html", content: "<h1>Old</h1>", baseRevision: 0 });
  let checks = 0;
  const before = llm.requests.length;
  llm.setScript((s, u) => {
    if (isPlan(s)) return planOne(co);
    if (isSummary(s)) return fence({ summary: "ok", verdicts: [] });
    if (isCheck(s)) return ++checks === 1 ? fence({ approved: false, fixes: ["Add pricing."] }) : fence({ approved: true, fixes: [] });
    if (isTask(s)) {
      if (u.startsWith("NOVA'S REVIEW")) return fence({ tool: "write_file", args: { path: "index.html", content: "<h1>V2 with pricing</h1>" } });
      if (u.startsWith("TOOL RESULT write_file") && checks === 1) return "Added pricing.";
      if (u.startsWith("TOOL RESULT")) return "First.";
      return fence({ tool: "write_file", args: { path: "index.html", content: "<h1>V1</h1>" } });
    }
    return "ok";
  });
  const done = await run(co, { text: "Improve the page", projectId: pid });
  const edits = done.edits.filter((e: { path: string }) => e.path === "index.html");
  expect(edits).toHaveLength(1);
  const full = await prisma.proposedEdit.findUniqueOrThrow({ where: { id: edits[0].id } });
  expect(full.content).toBe("<h1>V2 with pricing</h1>");
  const mine = llm.requests.slice(before);
  const second = mine.filter((q) => isCheck(systemOf(q)))[1];
  expect(userOf(second)).toContain("V2 with pricing");
  expect(userOf(second)).not.toContain("<h1>V1</h1>");
  const revision = mine.filter((q) => isTask(systemOf(q)) && userOf(q).startsWith("NOVA'S REVIEW"))[0];
  expect(userOf(revision)).toContain("Then reply with your complete final answer; it replaces your previous one.");
});

test("the design guide applies to every task that has a project", async () => {
  const co = await company(app, llm, "starter", { qualityChecks: false });
  const pid = (await co.req("POST", `/api/workspaces/${co.id}/projects`, { name: "Notes" })).json().id as string;
  const research = fence({ tasks: [{ agentId: co.others[0].id, title: "Research three competitors", instructions: "Compare their prices", deliverable: "A short table", criteria: ["Three competitors"], dependsOn: [] }] });
  llm.setScript((s) => (isPlan(s) ? research : isSummary(s) ? fence({ summary: "ok", verdicts: [] }) : s.includes("Pick the files") ? fence({ read: [] }) : isTask(s) ? "Done." : "ok"));
  await run(co, { text: "Research competitors", projectId: pid });
  expect(systemOf(llm.requests.filter((q) => isTask(systemOf(q))).at(-1)!)).toContain("DESIGN GUIDE");
});

test("a failed write doesn't leave read_file showing an old version", async () => {
  const co = await company(app, llm);
  const pid = (await co.req("POST", `/api/workspaces/${co.id}/projects`, { name: "Race" })).json().id as string;
  await co.req("PUT", `/api/workspaces/${co.id}/projects/${pid}/files`, { path: "a.txt", content: "one", baseRevision: 0 });
  const project = await prisma.project.findUniqueOrThrow({ where: { id: pid } });
  const owner = (await co.req("GET", "/api/me")).json().user.id as string;
  const tools = projectTools(project, {
    read: new Map(),
    write: async () => {
      throw new ToolError("This file changed since you opened it.");
    },
  });
  const tool = (name: string) => tools.find((t) => t.name === name)!;
  const signal = new AbortController().signal;
  expect(await tool("read_file").run({ path: "a.txt" } as never, signal)).toBe("one");
  await saveText(project, owner, "a.txt", "two", 1);
  await expect(tool("write_file").run({ path: "a.txt", content: "mine" } as never, signal)).rejects.toBeInstanceOf(ToolError);
  expect(await tool("read_file").run({ path: "a.txt" } as never, signal)).toBe("two");
});

test("a brief that can't be saved never stops the goal from starting; the plan template has no literal brief text", async () => {
  expect(planInstructions("Co", false)).not.toContain("(only for visual work)");
  const co = await company(app, llm);
  llm.setScript((s) => (isPlan(s) ? fence({ brief: "Warm and handmade.", projectName: "Site", tasks: [{ agentId: co.others[0].id, title: "Build the page", instructions: "i", deliverable: "d", criteria: ["c"], dependsOn: [] }] }) : isSummary(s) ? fence({ summary: "ok", verdicts: [] }) : isTask(s) ? "Done." : "ok"));
  const spy = vi.spyOn(prisma.projectEntry, "findFirst").mockRejectedValueOnce(new Error("database hiccup"));
  try {
    const done = await run(co, { text: "Build a site", newProject: true });
    expect(done.status).toBe("done");
  } finally {
    spy.mockRestore();
  }
});
