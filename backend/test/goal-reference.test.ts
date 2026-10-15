import type { ServerResponse } from "node:http";
import { afterAll, expect, test, vi } from "vitest";
import { fakeServer } from "./fake-provider.js";
import { makeApp } from "./helpers.js";
import { company, fakeLLM, fence, waitFor } from "./goal-helpers.js";

// Each test builds whole companies at remote-database latency.
vi.setConfig({ testTimeout: 240_000 });
const llm = await fakeLLM();
const app = await makeApp();

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const json = (res: ServerResponse, data: object) => void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ code: 200, data }));
// A fake Jina Reader: the path is the page address; the x-respond-with header picks text or screenshot.
const jina = await fakeServer({
  "GET /https://ref.example/": (q, res) => (q.headers["x-respond-with"] === "screenshot" ? json(res, { title: "Ref", screenshotUrl: `${jina.url}/shot.png` }) : json(res, { title: "Ref", content: "# Big hero\nShort line." })),
  "GET /https://down.example/": (_q, res) => void res.writeHead(429).end(),
  "GET /shot.png": (_q, res) => void res.writeHead(200, { "content-type": "image/png" }).end(PNG),
});
process.env.JINA_URL = jina.url;
afterAll(async () => {
  await jina.close();
  await llm.close();
  await app.close();
});

const isPlan = (s: string) => s.includes("Turn the owner's goal into a plan");
const isTask = (s: string) => s.includes("Nova assigned you a task");
const isSummary = (s: string) => s.includes("Review each task result");
type Co = Awaited<ReturnType<typeof company>>;
type Seen = { text: string; images: number };

/** Plans two tasks (the second waits for the first), runs the goal and records what each task was sent first. */
async function runGoal(co: Co, text: string) {
  const seen: Seen[] = [];
  llm.setScript((s, u, body) => {
    if (isPlan(s)) {
      const task = (i: number, title: string) => ({ agentId: co.others[i].id, title, instructions: `${title} for the owner.`, deliverable: "d", criteria: ["c"], dependsOn: i ? [0] : [] });
      return fence({ tasks: [task(0, "Design the page"), task(1, "Build the page")] });
    }
    if (isSummary(s)) return fence({ summary: "Done.", verdicts: [] });
    if (isTask(s)) {
      const first = body.messages.find((m) => m.role === "user")!.content;
      seen.push({ text: u, images: typeof first === "string" ? 0 : first.filter((p) => p.type === "image_url").length });
      return "Done.";
    }
    return "ok";
  });
  const gid = (await co.req("POST", `/api/workspaces/${co.id}/goals`, { text })).json().id as string;
  const get = async () => (await co.req("GET", `/api/workspaces/${co.id}/goals/${gid}`)).json().goal;
  await waitFor(get, (g) => g.status === "awaiting_approval");
  expect((await co.req("POST", `/api/workspaces/${co.id}/goals/${gid}/start`)).statusCode).toBe(200);
  const goal = await waitFor(get, (g) => g.status === "done" || g.status === "failed");
  return { goal, seen };
}

test("every task sees the reference site before it starts, and Jina is asked once per goal", async () => {
  const co = await company(app, llm);
  const before = jina.requests.length;
  const { goal, seen } = await runGoal(co, "Make a landing page like https://ref.example/");
  expect(goal.status).toBe("done");
  expect(seen).toHaveLength(2);
  for (const s of seen) {
    expect(s.text).toContain("REFERENCE SITE https://ref.example/");
    expect(s.text).toContain("# Big hero");
    expect(s.images).toBe(1);
  }
  // One text request and one screenshot request for the whole goal.
  expect(jina.requests.slice(before).filter((r) => r.path === "/https://ref.example/")).toHaveLength(2);
  expect(goal.tasks.map((t: { toolUses: { name: string; label: string; ok: boolean }[] }) => t.toolUses.map((u) => [u.name, u.label, u.ok]))).toEqual([
    [["look_at_website", "ref.example", true]],
    [["look_at_website", "ref.example", true]],
  ]);
});

test("a site that can't be opened still lets the task run, with a note to try again", async () => {
  const co = await company(app, llm);
  const { goal, seen } = await runGoal(co, "Make a landing page like https://down.example/");
  expect(goal.status).toBe("done");
  expect(seen[0].text).toContain("Couldn't look at https://down.example/ before you started");
  expect(seen[0].images).toBe(0);
  expect(goal.tasks[0].toolUses.map((u: { name: string; ok: boolean }) => [u.name, u.ok])).toEqual([["look_at_website", false]]);
});

test("a goal without a website sends tasks as before", async () => {
  const co = await company(app, llm);
  const { goal, seen } = await runGoal(co, "Write a short welcome note");
  expect(goal.status).toBe("done");
  expect(seen[0].text).not.toContain("REFERENCE SITE");
  expect(goal.tasks[0].toolUses).toEqual([]);
});
