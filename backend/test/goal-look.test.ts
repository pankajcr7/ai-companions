import type { ServerResponse } from "node:http";
import { afterAll, expect, test, vi } from "vitest";
import { fakeServer, type Handler } from "./fake-provider.js";
import { makeApp } from "./helpers.js";
import { company, fakeLLM, fence, waitFor } from "./goal-helpers.js";

// Each test builds whole companies at remote-database latency.
vi.setConfig({ testTimeout: 240_000 });
const llm = await fakeLLM();
const app = await makeApp();

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const json = (res: ServerResponse, data: object) => void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ code: 200, data }));
// A fake Jina Reader that answers for any page under the app's public address (preview links carry a fresh token).
const APP = "https://app.example";
const pages: Handler = (q, res) => (q.headers["x-respond-with"] === "screenshot" ? json(res, { title: "Built page", screenshotUrl: `${jina.url}/shot.png` }) : json(res, { title: "Built page", content: "# Built" }));
const jina = await fakeServer(new Proxy({ "GET /shot.png": ((_q, res) => void res.writeHead(200, { "content-type": "image/png" }).end(PNG)) as Handler } as Record<string, Handler>, {
  get: (routes, key: string) => (key.startsWith(`GET /${APP}/api/preview/`) ? pages : routes[key]),
}));
process.env.JINA_URL = jina.url;
afterAll(async () => {
  delete process.env.FRONTEND_URL;
  await jina.close();
  await llm.close();
  await app.close();
});

const isPlan = (s: string) => s.includes("Turn the owner's goal into a plan");
const isTask = (s: string) => s.includes("Nova assigned you a task");
const isReview = (s: string) => s.includes("Review a teammate's finished task");
const isSummary = (s: string) => s.includes("Review each task result");
type Body = { messages: { role: string; content: string | { type: string; text?: string; image_url?: { url: string } }[] }[] };

/** Builds a one-page site with Nova's check on; returns what each review was sent and the task's instructions. */
async function build(text = "Build a landing page for my bakery") {
  const co = await company(app, llm, "starter", { qualityChecks: true });
  const reviews: Body[] = [];
  const tasks: string[] = [];
  llm.setScript((s, _u, body) => {
    if (isPlan(s)) return fence({ projectName: "Bakery", tasks: [{ agentId: co.others[0].id, title: "Build the page", instructions: "Build index.html.", deliverable: "index.html", criteria: ["c"], dependsOn: [] }] });
    if (isReview(s)) return (reviews.push(body), fence({ approved: true, fixes: [] }));
    if (isSummary(s)) return fence({ summary: "Done.", verdicts: [] });
    if (isTask(s)) return (tasks.push(s), `Built it.\n\n${fence({ edits: [{ path: "index.html", content: "<h1>Crumb</h1>", note: "Page" }] })}`);
    return "ok";
  });
  const gid = (await co.req("POST", `/api/workspaces/${co.id}/goals`, { text, newProject: true })).json().id as string;
  const get = async () => (await co.req("GET", `/api/workspaces/${co.id}/goals/${gid}`)).json().goal;
  expect(await waitFor(get, (g) => g.status !== "planning")).toMatchObject({ status: "awaiting_approval" });
  expect((await co.req("POST", `/api/workspaces/${co.id}/goals/${gid}/start`)).statusCode).toBe(200);
  expect((await waitFor(get, (g) => g.status === "done" || g.status === "failed")).status).toBe("done");
  return Object.assign(reviews.map((b) => b.messages.filter((m) => m.role === "user").at(-1)!.content), { tasks });
}

test("Nova's check of a built page sees a screenshot of it through the public preview link", async () => {
  process.env.FRONTEND_URL = APP;
  const sent = jina.requests.length;
  const [review] = await build();
  expect(Array.isArray(review)).toBe(true);
  const parts = review as { type: string; text?: string; image_url?: { url: string } }[];
  expect(parts.find((p) => p.type === "text")?.text).toContain("LOOK CHECK");
  expect(parts.some((p) => p.type === "image_url" && p.image_url?.url.startsWith("data:image/png;base64,"))).toBe(true);
  const asked = jina.requests.slice(sent).map((r) => r.path).find((p) => p.startsWith(`/${APP}/api/preview/`));
  expect(asked).toMatch(new RegExp(`^/${APP}/api/preview/[^/]+/index\\.html$`));
});

test("without a public address, the check runs as before, without a screenshot", async () => {
  delete process.env.FRONTEND_URL;
  const [review] = await build();
  expect(typeof review).toBe("string");
  expect(review as string).not.toContain("LOOK CHECK");
});

test("a cinematic goal gives the team and Nova's check the cinematic guide; an ordinary one doesn't", async () => {
  delete process.env.FRONTEND_URL;
  const film = await build("Build a cinematic landing page for my film studio");
  expect(film.tasks[0]).toContain("CINEMATIC GUIDE");
  expect(film[0] as string).toContain("CINEMATIC GUIDE");
  const plain = await build();
  expect(plain.tasks[0]).not.toContain("CINEMATIC GUIDE");
  expect(plain[0] as string).not.toContain("CINEMATIC GUIDE");
});

test("a local (non-https) address takes no screenshot: the reader can't reach it", async () => {
  process.env.FRONTEND_URL = "http://localhost:3000";
  const sent = jina.requests.length;
  const [review] = await build();
  expect(typeof review).toBe("string");
  expect(jina.requests.slice(sent).some((r) => r.path.includes("/api/preview/"))).toBe(false);
});
