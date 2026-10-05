import { afterAll, expect, test, vi } from "vitest";
import { prisma } from "../src/db.js";
import { makeApp } from "./helpers.js";
import { company, fakeLLM, fence, sleep, systemOf, userOf, waitFor } from "./goal-helpers.js";

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
const tool = (name: string, args: object) => fence({ tool: name, args });
type Co = Awaited<ReturnType<typeof company>>;
async function run(co: Co, body: object, tasks = 1) {
  const gid = (await co.req("POST", `/api/workspaces/${co.id}/goals`, body)).json().id as string;
  const base = `/api/workspaces/${co.id}/goals/${gid}`;
  const get = async () => (await co.req("GET", base)).json().goal;
  await waitFor(get, (g) => g.status === "awaiting_approval");
  await co.req("POST", `${base}/start`);
  void tasks;
  return { base, get };
}
const planOne = (co: Co, extra: object = {}) => fence({ ...extra, tasks: [{ agentId: co.others[0].id, title: "Build the landing page", instructions: "Make index.html", deliverable: "The page", criteria: ["Has a pricing section"], dependsOn: [] }] });

test("Nova asks for a fix, the companion revises (and may rewrite files it created), then Nova approves", async () => {
  const co = await company(app, llm, "starter", { qualityChecks: true });
  let checks = 0;
  llm.setScript((s, u) => {
    if (isPlan(s)) return planOne(co, { projectName: "Site" });
    if (s.includes("Pick the files")) return fence({ read: [] });
    if (s.includes("Review each task result")) return fence({ summary: "ok", verdicts: [] });
    if (isCheck(s)) return ++checks === 1 ? fence({ approved: false, fixes: ["Add the pricing section from the request."] }) : fence({ approved: true, fixes: [] });
    if (isTask(s)) {
      if (u.startsWith("NOVA'S REVIEW")) return tool("write_file", { path: "index.html", content: "<h1>Site</h1><section>Pricing</section>" });
      if (u.startsWith("TOOL RESULT write_file index.html") && u.includes("Saved") && checks === 1) return "Added pricing.";
      if (u.startsWith("TOOL RESULT")) return "First version.";
      return tool("write_file", { path: "index.html", content: "<h1>Site</h1>" });
    }
    return "ok";
  });
  const g = await run(co, { text: "Build a site with pricing", newProject: true });
  const done = await waitFor(g.get, (x) => x.status === "done" || x.status === "failed");
  expect(done.tasks[0]).toMatchObject({ status: "done", result: "Added pricing.", review: { rounds: 1, approved: true, fixes: [["Add the pricing section from the request."]] } });
  const entry = await prisma.projectEntry.findFirstOrThrow({ where: { projectId: done.projectId, path: "index.html" } });
  expect(entry.revision).toBe(2);
  expect(done.edits.filter((e: { path: string }) => e.path === "index.html").map((e: { status: string }) => e.status)).toEqual(["applied", "applied"]);
  const check = llm.requests.filter((q) => isCheck(systemOf(q)))[0];
  expect(userOf(check)).toContain("Has a pricing section");
  expect(userOf(check)).toContain("<h1>Site</h1>");
  expect(systemOf(llm.requests.filter((q) => isTask(systemOf(q)))[0])).toContain("DESIGN GUIDE");
});

test("after 2 revisions without approval the task is done and needs the owner's eyes", async () => {
  const co = await company(app, llm, "starter", { qualityChecks: true });
  let revisions = 0;
  llm.setScript((s, u) => {
    if (isPlan(s)) return planOne(co);
    if (s.includes("Review each task result")) return fence({ summary: "ok", verdicts: [] });
    if (isCheck(s)) return fence({ approved: false, fixes: ["Still missing pricing."] });
    if (isTask(s)) return u.startsWith("NOVA'S REVIEW") ? `Try ${++revisions}.` : "First.";
    return "ok";
  });
  const g = await run(co, { text: "Build a page" });
  const done = await waitFor(g.get, (x) => x.status === "done" || x.status === "failed");
  expect(revisions).toBe(2);
  expect(done.tasks[0]).toMatchObject({ status: "done", result: "Try 2.", review: { rounds: 2, approved: false } });
  expect(done.tasks[0].review.fixes).toHaveLength(3);
});

test("an unreadable review counts as approved; with checks off there is no review", async () => {
  const co = await company(app, llm, "starter", { qualityChecks: true });
  llm.setScript((s) => (isPlan(s) ? planOne(co) : isCheck(s) ? "I think it's fine?" : s.includes("Review each task result") ? fence({ summary: "ok", verdicts: [] }) : isTask(s) ? "Done." : "ok"));
  const g = await run(co, { text: "Build a page" });
  const done = await waitFor(g.get, (x) => x.status === "done" || x.status === "failed");
  expect(done.tasks[0]).toMatchObject({ status: "done", result: "Done.", review: { rounds: 0, approved: true } });

  const off = await company(app, llm);
  const before = llm.requests.filter((q) => isCheck(systemOf(q))).length;
  llm.setScript((s) => (isPlan(s) ? planOne(off) : s.includes("Review each task result") ? fence({ summary: "ok", verdicts: [] }) : isTask(s) ? "Done." : "ok"));
  const g2 = await run(off, { text: "Build a page" });
  const done2 = await waitFor(g2.get, (x) => x.status === "done" || x.status === "failed");
  expect(done2.tasks[0].review).toBeNull();
  expect(llm.requests.filter((q) => isCheck(systemOf(q))).length).toBe(before);
});

test("Stop during a review ends the task as cancelled", async () => {
  const co = await company(app, llm, "starter", { qualityChecks: true });
  let reviewing = false;
  llm.setScript(async (s) => {
    if (isPlan(s)) return planOne(co);
    if (isCheck(s)) {
      reviewing = true;
      await sleep(10_000);
      return fence({ approved: true, fixes: [] });
    }
    return isTask(s) ? "Done." : "ok";
  });
  const g = await run(co, { text: "Build a page" });
  await waitFor(async () => reviewing, (r) => r, 60_000);
  await co.req("POST", `${g.base}/cancel`);
  await sleep(4000);
  const after = await g.get();
  expect(after.tasks[0].status).toBe("skipped");
});
