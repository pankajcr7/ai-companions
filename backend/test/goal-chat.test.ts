import { afterAll, expect, test, vi } from "vitest";
import { prisma } from "../src/db.js";
import { client, makeApp, signUp } from "./helpers.js";
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
const isReview = (s: string) => s.includes("Review each task result");
const isChat = (s: string) => s.includes("You are answering questions about a company goal");
const events = (body: string) => body.split("\n\n").filter(Boolean).map((b) => /event: (.*)/.exec(b)?.[1]);
type Co = Awaited<ReturnType<typeof company>>;

async function finishedGoal(co: Co, text = "Write the launch post", result = "POST-RESULT: Fresh bread daily.") {
  llm.setScript((s) =>
    isPlan(s)
      ? fence({ tasks: [{ agentId: co.others[0].id, title: "Draft post", instructions: "Write it", deliverable: "A post", criteria: ["Short"], dependsOn: [] }] })
      : isReview(s)
        ? fence({ summary: "Post drafted.", verdicts: [{ position: 0, verdict: "meets", note: "" }] })
        : isChat(s)
          ? "Use the **short** version."
          : result,
  );
  const gid = (await co.req("POST", `/api/workspaces/${co.id}/goals`, { text })).json().id as string;
  const base = `/api/workspaces/${co.id}/goals/${gid}`;
  const get = async () => (await co.req("GET", base)).json().goal;
  await waitFor(get, (g) => g.status === "awaiting_approval");
  await co.req("POST", `${base}/start`);
  await waitFor(get, (g) => g.status === "done");
  return { gid, base };
}

test("Nova answers about a finished goal using its results, and the chat is saved", async () => {
  const co = await company(app, llm);
  const g = await finishedGoal(co);
  const res = await co.req("POST", `${g.base}/chat`, { message: "Which version should we use?" });
  expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
  expect(events(res.body)).toEqual(["start", "delta", "done"]);
  const first = llm.requests.filter((q) => isChat(systemOf(q))).at(-1)!;
  expect(systemOf(first)).toContain("POST-RESULT: Fresh bread daily.");
  expect(systemOf(first)).toContain("NOVA'S SUMMARY:\nPost drafted.");
  expect(systemOf(first)).toContain("GOAL:\nWrite the launch post");
  await co.req("POST", `${g.base}/chat`, { message: "And why?" });
  const second = llm.requests.filter((q) => isChat(systemOf(q))).at(-1)!;
  const turns = (second.body as { messages: { role: string; content: string }[] }).messages.slice(1);
  expect(turns.map((m) => [m.role, m.content])).toEqual([
    ["user", "Which version should we use?"],
    ["assistant", "Use the **short** version."],
    ["user", "And why?"],
  ]);
  const history = (await co.req("GET", `${g.base}/chat`)).json().messages;
  expect(history.map((m: { role: string; status: string }) => [m.role, m.status])).toEqual([
    ["user", "complete"],
    ["assistant", "complete"],
    ["user", "complete"],
    ["assistant", "complete"],
  ]);
  expect(await prisma.goalStep.count({ where: { goalId: g.gid, phase: "chat" } })).toBe(2);
  expect((await co.req("DELETE", `${g.base}/chat`)).statusCode).toBe(204);
  expect((await co.req("GET", `${g.base}/chat`)).json().messages).toEqual([]);
});

test("long results are capped in the chat prompt; chat needs Nova's model", async () => {
  const co = await company(app, llm);
  const g = await finishedGoal(co, "Long one", `START ${"z".repeat(9000)}`);
  await co.req("POST", `${g.base}/chat`, { message: "Summarize" });
  const sent = systemOf(llm.requests.filter((q) => isChat(systemOf(q))).at(-1)!);
  expect(sent).toContain("[truncated: the result is longer than 6000 characters]");
  expect(sent).not.toContain("z".repeat(6100));
  await co.req("PATCH", `/api/workspaces/${co.id}/agents/${co.nova.id}`, { connectionId: null, model: null });
  const before = await prisma.goalMessage.count({ where: { goalId: g.gid } });
  const res = await co.req("POST", `${g.base}/chat`, { message: "Still there?" });
  expect(res.statusCode).toBe(409);
  expect(res.json().error.message).toMatch(/Nova has no AI model/);
  expect(await prisma.goalMessage.count({ where: { goalId: g.gid } })).toBe(before);
});

test("chat opens after approval; viewers read only; other companies get 404", async () => {
  const co = await company(app, llm);
  llm.setScript((s) => (isPlan(s) ? fence({ tasks: [{ agentId: co.nova.id, title: "t", instructions: "i", deliverable: "d", criteria: ["c"], dependsOn: [] }] }) : "ok"));
  const gid = (await co.req("POST", `/api/workspaces/${co.id}/goals`, { text: "Wait" })).json().id as string;
  const base = `/api/workspaces/${co.id}/goals/${gid}`;
  await waitFor(async () => (await co.req("GET", base)).json().goal, (g) => g.status === "awaiting_approval");
  const early = await co.req("POST", `${base}/chat`, { message: "Hi" });
  expect(early.statusCode).toBe(409);
  expect(early.json().error.message).toBe("Chat opens once the plan is approved.");

  const viewer = await signUp(app);
  const vid = (await client(app, viewer.cookie)("GET", "/api/me")).json().user.id;
  await prisma.membership.create({ data: { workspaceId: co.id, userId: vid, role: "viewer" } });
  const vreq = client(app, viewer.cookie);
  expect((await vreq("GET", `${base}/chat`)).statusCode).toBe(200);
  expect((await vreq("POST", `${base}/chat`, { message: "Hi" })).statusCode).toBe(403);
  const other = await company(app, llm);
  expect((await other.req("GET", `${base}/chat`)).statusCode).toBe(404);
  expect((await other.req("GET", `/api/workspaces/${other.id}/goals/${gid}/chat`)).statusCode).toBe(404);
});

test("a follow-up goal remembers the earlier goal's results and survives its deletion", async () => {
  const co = await company(app, llm);
  const first = await finishedGoal(co);
  llm.setScript((s) => (isPlan(s) ? fence({ tasks: [{ agentId: co.others[0].id, title: "Schedule it", instructions: "Pick times", deliverable: "A schedule", criteria: ["Has dates"], dependsOn: [] }] }) : "ok"));
  const res = await co.req("POST", `/api/workspaces/${co.id}/goals`, { text: "Now schedule it", parentGoalId: first.gid });
  expect(res.statusCode).toBe(201);
  const base = `/api/workspaces/${co.id}/goals/${res.json().id}`;
  const g = await waitFor(async () => (await co.req("GET", base)).json().goal, (x) => x.status === "awaiting_approval");
  expect(g.parent).toEqual({ id: first.gid, text: "Write the launch post" });
  const planReq = llm.requests.filter((q) => isPlan(systemOf(q))).at(-1)!;
  expect(userOf(planReq)).toContain("PREVIOUS GOAL");
  expect(userOf(planReq)).toContain("POST-RESULT: Fresh bread daily.");
  expect(userOf(planReq)).toContain("SUMMARY:\nPost drafted.");
  const other = await company(app, llm);
  expect((await other.req("POST", `/api/workspaces/${other.id}/goals`, { text: "Steal", parentGoalId: first.gid })).statusCode).toBe(404);
  await prisma.goal.delete({ where: { id: first.gid } });
  expect((await co.req("GET", base)).json().goal.parent).toBeNull();
});
