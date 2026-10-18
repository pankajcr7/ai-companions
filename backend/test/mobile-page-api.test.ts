import { afterAll, expect, test, vi } from "vitest";
import { prisma } from "../src/db.js";
import { client, makeApp, signUp } from "./helpers.js";
import { company, fakeLLM, fence, systemOf, userOf, waitFor } from "./goal-helpers.js";

vi.setConfig({ testTimeout: 240_000 });
const llm = await fakeLLM();
const app = await makeApp();
afterAll(async () => {
  await llm.close();
  await app.close();
});

const PNG = Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001", "hex");
const isPlan = (s: string) => s.includes("Turn the owner's goal into a plan");
type Co = Awaited<ReturnType<typeof company>>;

async function attach(co: { id: string; cookie: string }, name: string) {
  const boundary = "----b" + Math.random().toString(16).slice(2);
  const payload = Buffer.concat([Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${name}"\r\ncontent-type: application/octet-stream\r\n\r\n`), PNG, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const res = await app.inject({ method: "POST", url: `/api/workspaces/${co.id}/attachments`, payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}`, cookie: co.cookie, origin: "http://localhost:3000" } });
  return res.json().id as string;
}
const planned = (co: Co) =>
  llm.setScript((s) => (isPlan(s) ? fence({ projectName: "Trail", tasks: [{ agentId: co.others[0].id, title: "The look and the screen list", instructions: "i", deliverable: "d", criteria: ["c"], dependsOn: [] }] }) : "ok"));

test("a goal made with a screenshot links it before planning; someone else's screenshot is refused", async () => {
  const co = await company(app, llm);
  planned(co);
  const shot = await attach(co, "inspiration.png");
  const res = await co.req("POST", `/api/workspaces/${co.id}/goals`, { text: "Design a mobile app: hiking trails", newProject: true, attachmentIds: [shot] });
  expect(res.statusCode).toBe(201);
  const gid = res.json().id as string;
  await waitFor(async () => (await co.req("GET", `/api/workspaces/${co.id}/goals/${gid}`)).json().goal, (g) => g.status === "awaiting_approval");
  expect((await prisma.attachment.findUniqueOrThrow({ where: { id: shot } })).goalId).toBe(gid);
  const plan = llm.requests.filter((q) => q.path === "/v1/chat/completions" && isPlan(systemOf(q))).at(-1)!;
  expect(userOf(plan)).toContain("attachments/inspiration.png");

  const other = await signUp(app);
  const oid = (await client(app, other.cookie)("GET", "/api/me")).json().user.id;
  await prisma.membership.create({ data: { workspaceId: co.id, userId: oid, role: "member" } });
  const theirs = await attach({ id: co.id, cookie: other.cookie }, "theirs.png");
  await co.req("POST", `/api/workspaces/${co.id}/goals/${gid}/cancel`);
  expect((await co.req("POST", `/api/workspaces/${co.id}/goals`, { text: "Design a mobile app: quiz", newProject: true, attachmentIds: [theirs] })).statusCode).toBe(404);
});

test("the goals list says which goals are app designs and which follow another; the overview counts screens", async () => {
  const co = await company(app, llm);
  planned(co);
  const pid = (await co.req("POST", `/api/workspaces/${co.id}/projects`, { name: "Trail" })).json().id as string;
  for (const path of ["screens/01-home.html", "screens/02-map.html", "screens/old/x.html", "index.html", "screens/notes.md"]) {
    await co.req("PUT", `/api/workspaces/${co.id}/projects/${pid}/files`, { path, content: "<p>x</p>", baseRevision: 0 });
  }
  const first = (await co.req("POST", `/api/workspaces/${co.id}/goals`, { text: "Design a mobile app: trails", projectId: pid })).json().id as string;
  await waitFor(async () => (await co.req("GET", `/api/workspaces/${co.id}/goals/${first}`)).json().goal, (g) => g.status === "awaiting_approval");
  await co.req("POST", `/api/workspaces/${co.id}/goals/${first}/cancel`);
  const second = (await co.req("POST", `/api/workspaces/${co.id}/goals`, { text: "Write a welcome note", projectId: pid, parentGoalId: first })).json().id as string;
  const goals = (await co.req("GET", `/api/workspaces/${co.id}/goals`)).json().goals as { id: string; mobile: boolean; parentGoalId: string | null }[];
  expect(goals.find((g) => g.id === first)).toMatchObject({ mobile: true, parentGoalId: null });
  expect(goals.find((g) => g.id === second)).toMatchObject({ mobile: false, parentGoalId: first });
  // Your apps lists root goals (not capped by the newest goals of every kind); the app page finds a project's newest goal.
  const roots = (await co.req("GET", `/api/workspaces/${co.id}/goals?roots=1`)).json().goals as { id: string }[];
  expect(roots.map((g) => g.id)).toContain(first);
  expect(roots.map((g) => g.id)).not.toContain(second);
  const onProject = (await co.req("GET", `/api/workspaces/${co.id}/goals?projectId=${pid}`)).json().goals as { id: string }[];
  expect(onProject.map((g) => g.id)).toEqual([second, first]);
  const projects = (await co.req("GET", `/api/workspaces/${co.id}/projects?overview=1`)).json().projects as { id: string; overview: { screens: number } }[];
  expect(projects.find((p) => p.id === pid)!.overview.screens).toBe(2);
});
