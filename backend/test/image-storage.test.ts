import sharp from "sharp";
import { afterAll, expect, test, vi } from "vitest";
import { cleanupAttachments, madeImages } from "../src/attachments/service.js";
import { prisma } from "../src/db.js";
import { putBlob } from "../src/files/store.js";
import { createGoal } from "../src/goals/create.js";
import { fakeServer, json, type FakeRequest } from "./fake-provider.js";
import { makeApp } from "./helpers.js";
import { company, fakeLLM, fence, waitFor } from "./goal-helpers.js";

vi.setConfig({ testTimeout: 240_000 });
const ACC = "0123456789abcdef0123456789abcdef";
const PNG = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#c96" } }).png().toBuffer();
const llm = await fakeLLM();
const app = await makeApp();
const cf = await fakeServer({
  [`GET /accounts/${ACC}/ai/models/search`]: (_q, res) => json(res, 200, { success: true, result: [] }),
  [`POST /accounts/${ACC}/ai/run/@cf/black-forest-labs/flux-2-klein-4b`]: (_q, res) => json(res, 200, { success: true, result: { image: PNG.toString("base64") } }),
});
process.env.TEST_CLOUDFLARE_BASE_URL = cf.url;
afterAll(async () => {
  await llm.close();
  await cf.close();
  await app.close();
});
const tool = (name: string, args: object) => fence({ tool: name, args });
const isPlan = (s: string) => s.includes("Turn the owner's goal into a plan");
const isNova = (s: string) => s.includes("When the owner asks for work to be done") && !isPlan(s);
const isTask = (s: string) => s.includes("Nova assigned you a task");
const isReview = (s: string) => s.includes("Review a teammate's finished task");
const formOf = (q: FakeRequest) => new Response(new Uint8Array(q.bytes), { headers: { "content-type": String(q.headers["content-type"]) } }).formData();
type Co = Awaited<ReturnType<typeof company>>;
const withCloudflare = async (co: Co) => expect((await co.req("PUT", `/api/workspaces/${co.id}/image-keys/cloudflare`, { accountId: ACC, apiToken: "good-cloudflare-token-123" })).statusCode).toBe(200);
const userId = async (co: Co) => (await co.req("GET", "/api/me")).json().user.id as string;
async function finishGoal(co: Co, text: string) {
  const { id: gid } = await createGoal({ workspaceId: co.id, userId: await userId(co), text, newProject: true });
  const base = `/api/workspaces/${co.id}/goals/${gid}`;
  await waitFor(async () => (await co.req("GET", base)).json().goal, (g) => g.status === "awaiting_approval");
  await co.req("POST", `${base}/start`);
  return waitFor(async () => (await co.req("GET", base)).json().goal, (g) => g.status === "done" || g.status === "failed");
}

test("the daily cleanup removes unlinked uploads but keeps images that belong to a task", async () => {
  const co = await company(app, llm);
  llm.setScript((s) => (isPlan(s) ? fence({ tasks: [{ agentId: co.others[0].id, title: "t", instructions: "i", deliverable: "d", criteria: ["c"], dependsOn: [] }] }) : "ok"));
  const me = (await co.req("GET", "/api/me")).json().user.id as string;
  const { id: gid } = await createGoal({ workspaceId: co.id, userId: me, text: "Plan" });
  const goal = await waitFor(async () => (await co.req("GET", `/api/workspaces/${co.id}/goals/${gid}`)).json().goal, (g) => g.status === "awaiting_approval");
  const old = new Date(Date.now() - 25 * 3600_000);
  const blobHash = await putBlob(PNG);
  const row = { workspaceId: co.id, userId: me, mime: "image/png", kind: "image", size: PNG.length, blobHash, createdAt: old };
  const loose = await prisma.attachment.create({ data: { ...row, name: "loose.png" } });
  const kept = await prisma.attachment.create({ data: { ...row, name: "kept.png", taskId: goal.tasks[0].id } });
  await cleanupAttachments();
  expect(await prisma.attachment.findUnique({ where: { id: loose.id } })).toBeNull();
  expect(await prisma.attachment.findUnique({ where: { id: kept.id } })).not.toBeNull();
});

test("with no image key there's no image tool; with Cloudflare, Nova's image shows under her reply, saves to a project, and can be edited by name", async () => {
  const co = await company(app, llm);
  const cid = (await co.req("POST", `/api/workspaces/${co.id}/conversations`)).json().id as string;
  const base = `/api/workspaces/${co.id}/conversations/${cid}`;
  const seen: string[] = [];
  llm.setScript((s, u) => {
    if (!isNova(s)) return "ok";
    seen.push(s);
    if (u === "Hello") return "Hi.";
    if (u.startsWith("TOOL RESULT generate_image")) return u.includes("Make image 1 blue") ? "Bluer now." : "Here it is.";
    return /blue/i.test(u) ? tool("generate_image", { prompt: "Make image 1 blue", from: ["logo.png"], name: "logo-blue" }) : tool("generate_image", { prompt: "A warm bakery logo", name: "logo" });
  });
  await co.req("POST", `${base}/messages`, { message: "Hello" });
  expect(seen.at(-1)).not.toContain("generate_image");

  await withCloudflare(co);
  const res = await co.req("POST", `${base}/messages`, { message: "Make me a logo" });
  expect(res.body).toContain('event: tool\ndata: {"name":"generate_image","label":"“A warm bakery logo”"}');
  let reply = (await co.req("GET", base)).json().messages.at(-1);
  expect(reply).toMatchObject({ content: "Here it is.", toolUses: [{ name: "generate_image", label: "“A warm bakery logo” · free", ok: true }], attachments: [{ name: "logo.png", kind: "image", mime: "image/png" }] });
  expect((await co.req("GET", reply.attachments[0].url)).statusCode).toBe(200);
  const pid = (await co.req("POST", `/api/workspaces/${co.id}/projects`, { name: "Brand" })).json().id as string;
  expect((await co.req("POST", `/api/workspaces/${co.id}/attachments/${reply.attachments[0].id}/save`, { projectId: pid })).json()).toEqual({ path: "attachments/logo.png" });

  await co.req("POST", `${base}/messages`, { message: "Make it blue" });
  reply = (await co.req("GET", base)).json().messages.at(-1);
  expect(reply.content).toBe("Bluer now.");
  expect(reply.attachments.map((a: { name: string }) => a.name)).toEqual(["logo-blue.png"]);
  expect((await formOf(cf.requests.at(-1)!)).get("input_image_0")).toBeInstanceOf(File);
});

test("task images land in the goal's project under images/, show on the task card, and stop at 4 across Nova's revision round; planning has no image tool", async () => {
  const co = await company(app, llm, "starter", { qualityChecks: true });
  await withCloudflare(co);
  const planSaw: boolean[] = [];
  let n = 0;
  let reviewed = false;
  llm.setScript((s, u) => {
    if (isPlan(s)) {
      planSaw.push(s.includes("generate_image"));
      return fence({ projectName: "Shop", tasks: [{ agentId: co.others[0].id, title: "Make the hero pictures", instructions: "i", deliverable: "d", criteria: ["c"], dependsOn: [] }] });
    }
    if (s.includes("Pick the files")) return fence({ read: [] });
    if (isReview(s)) {
      if (reviewed) return fence({ approved: true, fixes: [] });
      reviewed = true;
      return fence({ approved: false, fixes: ["Add more pictures"] });
    }
    if (s.includes("Review each task result")) return fence({ summary: "ok", verdicts: [] });
    if (isTask(s)) return u.includes("the limit") ? "Done." : tool("generate_image", { prompt: `Hero picture ${++n}`, name: "hero" });
    return "ok";
  });
  const done = await finishGoal(co, "Make hero pictures");
  expect(done.status).toBe("done");
  expect(planSaw).toEqual([false]);
  expect(reviewed).toBe(true);
  expect(done.tasks[0].media.map((m: { name: string }) => m.name)).toEqual(["hero.png", "hero.png", "hero.png", "hero.png"]);
  const images = done.edits.filter((e: { note: string }) => e.note === "Image").map((e: { path: string; status: string }) => [e.path, e.status]);
  expect(images).toEqual([["images/hero.png", "applied"], ["images/hero (2).png", "applied"], ["images/hero (3).png", "applied"], ["images/hero (4).png", "applied"]]);
  expect(await prisma.projectEntry.count({ where: { projectId: done.projectId, path: { startsWith: "images/" } } })).toBe(4);
});

test("goal chat images belong to the chat message; a non-image can't be edited; a full project still shows the image", async () => {
  const co = await company(app, llm);
  await withCloudflare(co);
  llm.setScript((s, u) => {
    if (isPlan(s)) return fence({ projectName: "Hello", tasks: [{ agentId: co.others[0].id, title: "Say hi", instructions: "i", deliverable: "d", criteria: ["c"], dependsOn: [] }] });
    if (s.includes("Pick the files")) return fence({ read: [] });
    if (s.includes("Review each task result")) return fence({ summary: "ok", verdicts: [] });
    if (isTask(s)) return "Hi.";
    if (s.includes("You are answering questions about a company goal")) return u.startsWith("TOOL RESULT generate_image") ? "Made a banner." : tool("generate_image", { prompt: "A banner" });
    return "ok";
  });
  const done = await finishGoal(co, "Say hi");
  const chat = `/api/workspaces/${co.id}/goals/${done.id}/chat`;
  await co.req("POST", chat, { message: "Make a banner for this" });
  expect((await co.req("GET", chat)).json().messages.at(-1)).toMatchObject({ content: "Made a banner.", attachments: [{ name: "a-banner.png", kind: "image" }] });

  const me = await userId(co);
  await co.req("PUT", `/api/workspaces/${co.id}/projects/${done.projectId}/files`, { path: "menu.md", content: "Croissant 3", baseRevision: 0 });
  const project = await prisma.project.findUniqueOrThrow({ where: { id: done.projectId } });
  const made = madeImages({ workspaceId: co.id, userId: me, files: [], project, task: { id: done.tasks[0].id, goalId: done.id } });
  await expect(made.source("menu.md")).rejects.toThrow("menu.md isn't an image.");
  await expect(made.source("nope.png")).rejects.toThrow("There's no image called nope.png. Use list_attachments or list_files to see them.");

  await prisma.project.update({ where: { id: done.projectId }, data: { totalBytes: 50 * 1024 * 1024 } });
  const full = madeImages({ workspaceId: co.id, userId: me, files: [], project: { ...project, totalBytes: 50 * 1024 * 1024 }, task: { id: done.tasks[0].id, goalId: done.id } });
  expect(await full.media.save(PNG, "full.png")).toMatch(/^Shown to the owner on the task card as full\.png; it couldn't be added to the project \(/);
  expect(await prisma.proposedEdit.count({ where: { goalId: done.id, note: "Image" } })).toBe(0);
  expect((await co.req("GET", `/api/workspaces/${co.id}/goals/${done.id}`)).json().goal.tasks[0].media.map((m: { name: string }) => m.name)).toEqual(["full.png"]);
});
