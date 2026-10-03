import { afterAll, expect, test, vi } from "vitest";
import { prisma } from "../src/db.js";
import { client, makeApp, signUp } from "./helpers.js";
import { company, fakeLLM, fence, systemOf, waitFor } from "./goal-helpers.js";

vi.setConfig({ testTimeout: 240_000 });
const llm = await fakeLLM();
const app = await makeApp();
afterAll(async () => {
  await llm.close();
  await app.close();
});

const isPlan = (s: string) => s.includes("Turn the owner's goal into a plan");
const isReview = (s: string) => s.includes("Review each task result");
const isNova = (s: string) => s.includes("When the owner asks for work to be done") && !s.includes("Turn the owner's goal into a plan");
const suggest = (goal: string, extra: object = {}) => `I'll get the team on it.\n\n${fence({ suggest: { goal, ...extra } })}`;
type Co = Awaited<ReturnType<typeof company>>;

async function conversation(co: Co) {
  const cid = (await co.req("POST", `/api/workspaces/${co.id}/conversations`)).json().id as string;
  const base = `/api/workspaces/${co.id}/conversations/${cid}`;
  const send = (message: string, project: object = { kind: "none" }) => co.req("POST", `${base}/messages`, { message, project });
  const get = async () => (await co.req("GET", base)).json();
  return { cid, base, send, get };
}

test("a question gets an answer; a work request becomes a planned goal linked to Nova's reply", async () => {
  const co = await company(app, llm);
  llm.setScript((s, u) => {
    if (isPlan(s)) return fence({ tasks: [{ agentId: co.others[0].id, title: "Write posts", instructions: "w", deliverable: "d", criteria: ["c"], dependsOn: [] }] });
    if (isNova(s)) return u.includes("posts") ? suggest("Write a week of posts") : "We sell bread.";
    return "ok";
  });
  const c = await conversation(co);
  await c.send("What do we sell?");
  await c.send("Write a week of Instagram posts");
  const data = await c.get();
  expect(data.conversation.title).toBe("What do we sell?");
  expect(data.messages.map((m: { role: string; goalId: string | null }) => [m.role, !!m.goalId])).toEqual([
    ["user", false],
    ["assistant", false],
    ["user", false],
    ["assistant", true],
  ]);
  const gid = data.messages[3].goalId;
  const goal = await waitFor(async () => (await co.req("GET", `/api/workspaces/${co.id}/goals/${gid}`)).json().goal, (g) => g.status === "awaiting_approval");
  expect(goal.text).toBe("Write a week of posts");
  const list = (await co.req("GET", `/api/workspaces/${co.id}/conversations`)).json().conversations;
  expect(list[0]).toMatchObject({ id: c.cid, title: "What do we sell?" });
});

test("Nova sees the conversation's goal results; the chip picks the project; new projects too", async () => {
  const co = await company(app, llm);
  const pid = (await co.req("POST", `/api/workspaces/${co.id}/projects`, { name: "Site" })).json().id as string;
  llm.setScript((s, u) => {
    if (isPlan(s)) return fence({ projectName: "Shop", tasks: [{ agentId: co.others[0].id, title: "Draft", instructions: "w", deliverable: "d", criteria: ["c"], dependsOn: [] }] });
    if (isReview(s)) return fence({ summary: "Drafted the copy.", verdicts: [] });
    if (isNova(s)) return u.includes("shop") ? suggest("Build a shop", { newProject: true }) : u.includes("Write the copy") ? suggest("Write the copy") : "It says fresh bread.";
    return "COPY-RESULT: Fresh bread daily";
  });
  const c = await conversation(co);
  await c.send("Write the copy", { kind: "existing", id: pid });
  const gid = (await c.get()).messages[1].goalId as string;
  const gbase = `/api/workspaces/${co.id}/goals/${gid}`;
  const g = await waitFor(async () => (await co.req("GET", gbase)).json().goal, (x) => x.status === "awaiting_approval");
  expect(g.projectId).toBe(pid);
  await co.req("POST", `${gbase}/start`);
  await waitFor(async () => (await co.req("GET", gbase)).json().goal, (x) => x.status === "done");
  await c.send("What does the copy say?");
  const sent = systemOf(llm.requests.filter((q) => isNova(systemOf(q))).at(-1)!);
  expect(sent).toContain("GOALS IN THIS CONVERSATION");
  expect(sent).toContain("COPY-RESULT: Fresh bread daily");
  expect(sent).toContain("Drafted the copy.");
  await c.send("Now build a shop");
  const shopGoal = (await c.get()).messages.at(-1).goalId as string;
  const shop = await waitFor(async () => (await co.req("GET", `/api/workspaces/${co.id}/goals/${shopGoal}`)).json().goal, (x) => x.status === "awaiting_approval");
  expect(shop).toMatchObject({ newProject: true, parent: { id: gid } });
});

test("a second work request while a goal is busy is marked, not planned; hire-only creates nothing", async () => {
  const co = await company(app, llm);
  // Planning waits until the test opens the gate, so the first goal is still busy however slow the database is.
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  llm.setScript(async (s, u) => {
    if (isPlan(s)) return (await gate, fence({ tasks: [{ agentId: co.nova.id, title: "t", instructions: "i", deliverable: "d", criteria: ["c"], dependsOn: [] }] }));
    if (isNova(s)) return u.includes("hire") ? `No marketer.\n\n${fence({ suggest: { hire: [{ role: "Marketing lead" }] } })}` : suggest(u);
    return "ok";
  });
  const c = await conversation(co);
  await c.send("First job");
  await c.send("Second job");
  await c.send("Please hire someone");
  const msgs = (await c.get()).messages.filter((m: { role: string }) => m.role === "assistant");
  expect(msgs.map((m: { goalId: string | null; planBlocked: string | null }) => [!!m.goalId, m.planBlocked])).toEqual([
    [true, null],
    [false, "busy"],
    [false, null],
  ]);
  open();
});

test("titles are cut; deleting a conversation keeps its goal; others' conversations are private; viewers read only", async () => {
  const co = await company(app, llm);
  llm.setScript((s) => (isPlan(s) ? fence({ tasks: [{ agentId: co.nova.id, title: "t", instructions: "i", deliverable: "d", criteria: ["c"], dependsOn: [] }] }) : isNova(s) ? suggest("Do the thing") : "ok"));
  const c = await conversation(co);
  await c.send(`Please ${"x".repeat(100)}`);
  const data = await c.get();
  expect(data.conversation.title).toBe(`Please ${"x".repeat(50)}...`);
  const gid = data.messages[1].goalId as string;
  expect((await co.req("PATCH", c.base, { title: "Renamed" })).statusCode).toBe(200);
  expect((await co.req("DELETE", c.base)).statusCode).toBe(204);
  expect((await co.req("GET", c.base)).statusCode).toBe(404);
  expect((await co.req("GET", `/api/workspaces/${co.id}/goals/${gid}`)).statusCode).toBe(200);

  const c2 = await conversation(co);
  const other = await signUp(app);
  const oid = (await client(app, other.cookie)("GET", "/api/me")).json().user.id;
  await prisma.membership.create({ data: { workspaceId: co.id, userId: oid, role: "viewer" } });
  const oreq = client(app, other.cookie);
  expect((await oreq("GET", c2.base)).statusCode).toBe(404);
  expect((await oreq("GET", `/api/workspaces/${co.id}/conversations`)).json().conversations).toEqual([]);
  expect((await oreq("POST", `/api/workspaces/${co.id}/conversations`)).statusCode).toBe(403);
  expect((await oreq("POST", `${c2.base}/messages`, { message: "hi", project: { kind: "none" } })).statusCode).toBe(403);
});
