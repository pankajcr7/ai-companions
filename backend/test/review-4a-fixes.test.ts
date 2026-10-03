import { afterAll, expect, test, vi } from "vitest";
import { prisma } from "../src/db.js";
import { signPreview } from "../src/files/preview.js";
import { makeApp } from "./helpers.js";
import { company, fakeLLM, fence, sleep, waitFor } from "./goal-helpers.js";

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
const isNova = (s: string) => s.includes("When the owner asks for work to be done") && !isPlan(s);
type Co = Awaited<ReturnType<typeof company>>;
const task = (agentId: string, title: string) => ({ agentId, title, instructions: "i", deliverable: "d", criteria: ["c"], dependsOn: [] });

async function startedNewProject(co: Co, tasks: object[]) {
  const gid = (await co.req("POST", `/api/workspaces/${co.id}/goals`, { text: "Build", newProject: true })).json().id as string;
  const base = `/api/workspaces/${co.id}/goals/${gid}`;
  const get = async () => (await co.req("GET", base)).json().goal;
  await waitFor(get, (g) => g.status === "awaiting_approval");
  await co.req("POST", `${base}/start`);
  void tasks;
  return { gid, base, get };
}

test("Stop while files are being saved: saving stops, and every saved file is listed", async () => {
  const co = await company(app, llm);
  const files = Array.from({ length: 6 }, (_, i) => ({ path: `site/page${i}.html`, content: `<h1>${i}</h1>` }));
  llm.setScript((s) => (isPlan(s) ? fence({ projectName: "Many files", tasks: [task(co.others[0].id, "Build pages")] }) : isSelect(s) ? fence({ read: [] }) : isTask(s) ? `Pages.\n${fence({ edits: files })}` : isReview(s) ? fence({ summary: "ok", verdicts: [] }) : "ok"));
  const g = await startedNewProject(co, []);
  const running = await waitFor(g.get, (x) => !!x.projectId && x.status === "running");
  await waitFor(() => prisma.projectEntry.count({ where: { projectId: running.projectId, kind: "file" } }), (n) => n >= 1, 60_000);
  await co.req("POST", `${g.base}/cancel`);
  await sleep(12_000);
  const saved = (await prisma.projectEntry.findMany({ where: { projectId: running.projectId, kind: "file" }, select: { path: true } })).map((e) => e.path).sort();
  const listed = (await g.get()).edits.filter((e: { status: string }) => e.status === "applied").map((e: { path: string }) => e.path).sort();
  expect(saved.length).toBeLessThan(files.length);
  expect(listed).toEqual(saved);
});

test("two tasks creating the same file at once: both finish, one saves it and the other is told why", async () => {
  const co = await company(app, llm);
  const [a, b] = co.others;
  llm.setScript(async (s, u) => {
    if (isPlan(s)) return fence({ projectName: "Shared", tasks: [task(a.id, "Part A"), task(b.id, "Part B")] });
    if (isSelect(s)) return fence({ read: [] });
    if (isReview(s)) return fence({ summary: "ok", verdicts: [] });
    if (isTask(s)) {
      await sleep(1500);
      const me = u.includes("YOUR TASK:\nPart A") ? "a" : "b";
      return `Done.\n${fence({ edits: [{ path: "style.css", content: `/* ${me} */` }, { path: `${me}.html`, content: me }] })}`;
    }
    return "ok";
  });
  const g = await startedNewProject(co, []);
  const done = await waitFor(g.get, (x) => x.status === "done" || x.status === "failed");
  expect(done.tasks.map((t: { status: string }) => t.status)).toEqual(["done", "done"]);
  const style = done.edits.filter((e: { path: string }) => e.path === "style.css").map((e: { status: string }) => e.status).sort();
  expect(style).toEqual(["applied", "rejected"]);
});

test("a busy work request can be planned later from its message, linked into the conversation", async () => {
  const co = await company(app, llm);
  llm.setScript(async (s, u) => {
    if (isPlan(s)) return fence({ tasks: [task(co.nova.id, "t")] });
    if (isNova(s)) return `On it.\n\n${fence({ suggest: { goal: u } })}`;
    return "ok";
  });
  const cid = (await co.req("POST", `/api/workspaces/${co.id}/conversations`)).json().id as string;
  const cbase = `/api/workspaces/${co.id}/conversations/${cid}`;
  await co.req("POST", `${cbase}/messages`, { message: "First job", project: { kind: "none" } });
  await co.req("POST", `${cbase}/messages`, { message: "Second job", project: { kind: "none" } });
  const msgs = (await co.req("GET", cbase)).json().messages.filter((m: { role: string }) => m.role === "assistant");
  const firstGoal = msgs[0].goalId as string;
  expect(msgs[1].planBlocked).toBe("busy");
  await waitFor(async () => (await co.req("GET", `/api/workspaces/${co.id}/goals/${firstGoal}`)).json().goal, (x) => x.status === "awaiting_approval");
  const res = await co.req("POST", `${cbase}/messages/${msgs[1].id}/plan`);
  expect(res.statusCode).toBe(200);
  expect((await co.req("POST", `${cbase}/messages/${msgs[1].id}/plan`)).statusCode).toBe(409);
  const after = (await co.req("GET", cbase)).json().messages.filter((m: { role: string }) => m.role === "assistant")[1];
  expect(after).toMatchObject({ planBlocked: null });
  const g = (await co.req("GET", `/api/workspaces/${co.id}/goals/${after.goalId}`)).json().goal;
  expect(g).toMatchObject({ text: "Second job", parent: { id: firstGoal } });
});

test("long conversations show their newest 200 messages", async () => {
  const co = await company(app, llm);
  const cid = (await co.req("POST", `/api/workspaces/${co.id}/conversations`)).json().id as string;
  const me = (await co.req("GET", "/api/me")).json().user.id as string;
  const t0 = Date.now() - 300_000;
  await prisma.chatMessage.createMany({
    data: Array.from({ length: 205 }, (_, i) => ({ workspaceId: co.id, agentId: co.nova.id, userId: me, conversationId: cid, role: "user" as const, content: `m${i}`, createdAt: new Date(t0 + i * 1000) })),
  });
  const msgs = (await co.req("GET", `/api/workspaces/${co.id}/conversations/${cid}`)).json().messages;
  expect(msgs).toHaveLength(200);
  expect(msgs[0].content).toBe("m5");
  expect(msgs.at(-1).content).toBe("m204");
});

test("preview links can't be made without a valid server key", () => {
  const original = process.env.CREDENTIALS_KEY;
  try {
    delete process.env.CREDENTIALS_KEY;
    expect(() => signPreview("p1")).toThrow(/CREDENTIALS_KEY/);
  } finally {
    process.env.CREDENTIALS_KEY = original;
  }
});
