import { afterAll, expect, test, vi } from "vitest";
import { prisma } from "../src/db.js";
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
const isSelect = (s: string) => s.includes("Pick the files you need to read");
const isTask = (s: string) => s.includes("Nova assigned you a task");
const isReview = (s: string) => s.includes("Review each task result");
type Co = Awaited<ReturnType<typeof company>>;

async function newProjectGoal(co: Co, text = "Build a bakery site") {
  const res = await co.req("POST", `/api/workspaces/${co.id}/goals`, { text, newProject: true });
  expect(res.statusCode).toBe(201);
  const base = `/api/workspaces/${co.id}/goals/${res.json().id}`;
  const get = async () => (await co.req("GET", base)).json().goal;
  return { gid: res.json().id as string, base, get };
}

test("a new-project goal plans a name, creates the project at Start, and saves the files it creates", async () => {
  const co = await company(app, llm);
  const [designer, builder] = co.others;
  llm.setScript((s, u) => {
    if (isPlan(s)) return fence({ projectName: "Bakery site", tasks: [{ agentId: designer.id, title: "Design", instructions: "Styles", deliverable: "CSS", criteria: ["Brown"], dependsOn: [] }, { agentId: builder.id, title: "Build", instructions: "Page", deliverable: "HTML", criteria: ["Heading"], dependsOn: [0] }] });
    if (isSelect(s)) return fence({ read: u.includes("TASK:\nBuild") ? ["site/style.css"] : [] });
    if (isReview(s)) return fence({ summary: "Built.", verdicts: [] });
    if (isTask(s) && u.includes("YOUR TASK:\nDesign")) return `Styles ready.\n${fence({ edits: [{ path: "site/style.css", content: "h1{color:brown}" }, { path: ".env", content: "S=1" }] })}`;
    if (isTask(s)) return `Page ready.\n${fence({ edits: [{ path: "site/index.html", content: "<h1>Crumb</h1>" }, { path: "site/style.css", content: "h1{color:red}" }] })}`;
    return "ok";
  });
  const g = await newProjectGoal(co);
  const planned = await waitFor(g.get, (x) => x.status === "awaiting_approval");
  expect(planned).toMatchObject({ newProject: true, projectName: "Bakery site", projectId: null });
  expect(systemOf(llm.requests.filter((q) => isPlan(systemOf(q))).at(-1)!)).toContain("This goal builds a NEW project");
  expect(await prisma.project.count({ where: { workspaceId: co.id } })).toBe(0);

  const [s1, s2] = await Promise.all([co.req("POST", `${g.base}/start`), co.req("POST", `${g.base}/start`)]);
  expect([s1.statusCode, s2.statusCode].sort()).toEqual([200, 409]);
  const final = await waitFor(g.get, (x) => x.status === "done");
  const projects = await prisma.project.findMany({ where: { workspaceId: co.id } });
  expect(projects.map((p) => p.name)).toEqual(["Bakery site"]);
  expect(final.projectId).toBe(projects[0].id);
  expect(final.edits.map((e: { path: string; baseRevision: number; status: string }) => [e.path, e.baseRevision, e.status])).toEqual([
    ["site/style.css", 0, "applied"],
    [".env", 0, "rejected"],
    ["site/index.html", 0, "applied"],
    ["site/style.css", 1, "pending"],
  ]);
  const files = `/api/workspaces/${co.id}/projects/${projects[0].id}/files`;
  expect((await co.req("GET", `${files}?path=site/index.html`)).json()).toMatchObject({ content: "<h1>Crumb</h1>", revision: 1 });
  expect((await co.req("GET", `${files}?path=site/style.css`)).json()).toMatchObject({ content: "h1{color:brown}", revision: 1 });
  const build = llm.requests.filter((q) => isTask(systemOf(q)) && userOf(q).includes("YOUR TASK:\nBuild")).at(-1)!;
  expect(userOf(build)).toContain('<file path="site/style.css">\nh1{color:brown}');
});

test("a plan without a project name is repaired; plan edits rename; taken names get a number; cancel creates nothing", async () => {
  const co = await company(app, llm);
  await co.req("POST", `/api/workspaces/${co.id}/projects`, { name: "Bakery site" });
  let n = 0;
  const task = { agentId: co.nova.id, title: "Build", instructions: "Page", deliverable: "HTML", criteria: ["Heading"], dependsOn: [] };
  llm.setScript((s) => (isPlan(s) ? (++n === 1 ? fence({ tasks: [task] }) : fence({ projectName: "Bakery site", tasks: [task] })) : isReview(s) ? fence({ summary: "ok", verdicts: [] }) : "ok"));
  const g = await newProjectGoal(co);
  await waitFor(g.get, (x) => x.status === "awaiting_approval");
  expect(userOf(llm.requests.filter((q) => isPlan(systemOf(q))).at(-1)!)).toMatch(/projectName/);
  expect((await co.req("PUT", `${g.base}/plan`, { tasks: [task] })).statusCode).toBe(400);
  expect((await co.req("PUT", `${g.base}/plan`, { projectName: "Bakery site", tasks: [task] })).statusCode).toBe(200);
  await co.req("POST", `${g.base}/start`);
  await waitFor(g.get, (x) => x.status === "done");
  const names = (await prisma.project.findMany({ where: { workspaceId: co.id }, orderBy: { createdAt: "asc" } })).map((p) => p.name);
  expect(names).toEqual(["Bakery site", "Bakery site 2"]);

  const c = await newProjectGoal(co, "Another site");
  await waitFor(c.get, (x) => x.status === "awaiting_approval");
  await co.req("POST", `${c.base}/cancel`);
  expect(await prisma.project.count({ where: { workspaceId: co.id } })).toBe(2);
});
