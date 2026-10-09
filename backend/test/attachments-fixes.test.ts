import { afterAll, expect, test, vi } from "vitest";
import { prisma } from "../src/db.js";
import { createGoal } from "../src/goals/create.js";
import { makeApp } from "./helpers.js";
import { company, fakeLLM, fence, waitFor } from "./goal-helpers.js";

vi.setConfig({ testTimeout: 240_000 });
const llm = await fakeLLM();
const app = await makeApp();
afterAll(async () => {
  await llm.close();
  await app.close();
});
const isPlan = (s: string) => s.includes("Turn the owner's goal into a plan");
const isTask = (s: string) => s.includes("Nova assigned you a task");
type Co = Awaited<ReturnType<typeof company>>;
async function attach(co: Co, name: string, data: Buffer) {
  const boundary = "----b" + Math.random().toString(16).slice(2);
  const payload = Buffer.concat([Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${name}"\r\ncontent-type: application/octet-stream\r\n\r\n`), data, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return (await app.inject({ method: "POST", url: `/api/workspaces/${co.id}/attachments`, payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}`, cookie: co.cookie, origin: "http://localhost:3000" } })).json().id as string;
}

test("files are linked to the goal before Nova starts planning", async () => {
  const co = await company(app, llm);
  const order: string[] = [];
  llm.setScript((s) => (isPlan(s) ? (order.push("plan"), fence({ tasks: [{ agentId: co.nova.id, title: "t", instructions: "i", deliverable: "d", criteria: ["c"], dependsOn: [] }] })) : "ok"));
  const me = (await co.req("GET", "/api/me")).json().user.id as string;
  const goal = await createGoal({ workspaceId: co.id, userId: me, text: "Plan with files", beforePlan: async () => void order.push("link") });
  await waitFor(async () => (await co.req("GET", `/api/workspaces/${co.id}/goals/${goal.id}`)).json().goal, (g) => g.status === "awaiting_approval");
  expect(order).toEqual(["link", "plan"]);
});

test("companions never silently rewrite the owner's attachments, even in a goal's own new project", async () => {
  const co = await company(app, llm);
  let round = 0;
  llm.setScript((s) => {
    if (isPlan(s)) return fence({ projectName: "Shop", tasks: [{ agentId: co.others[0].id, title: "Update the menu", instructions: "i", deliverable: "d", criteria: ["c"], dependsOn: [] }] });
    if (s.includes("Pick the files")) return fence({ read: [] });
    if (s.includes("Review each task result")) return fence({ summary: "ok", verdicts: [] });
    if (isTask(s)) return ++round === 1 ? fence({ tool: "write_file", args: { path: "attachments/menu.md", content: "Rewritten by a companion" } }) : "Done.";
    return `On it.\n\n${fence({ suggest: { goal: "Update my menu.md", newProject: true } })}`;
  });
  const id = await attach(co, "menu.md", Buffer.from("Croissant 3"));
  const cid = (await co.req("POST", `/api/workspaces/${co.id}/conversations`)).json().id as string;
  await co.req("POST", `/api/workspaces/${co.id}/conversations/${cid}/messages`, { message: "Update my menu", project: { kind: "new" }, attachmentIds: [id] });
  const gid = (await co.req("GET", `/api/workspaces/${co.id}/conversations/${cid}`)).json().messages.at(-1).goalId as string;
  const base = `/api/workspaces/${co.id}/goals/${gid}`;
  await waitFor(async () => (await co.req("GET", base)).json().goal, (g) => g.status === "awaiting_approval");
  await co.req("POST", `${base}/start`);
  const done = await waitFor(async () => (await co.req("GET", base)).json().goal, (g) => g.status === "done" || g.status === "failed");
  const entry = await prisma.projectEntry.findFirstOrThrow({ where: { projectId: done.projectId, path: "attachments/menu.md" } });
  expect(entry.revision).toBe(1);
  expect(done.edits.filter((e: { path: string; status: string; note: string }) => e.path === "attachments/menu.md" && e.note !== "Your attachment").map((e: { status: string }) => e.status)).toEqual(["pending"]);
});
