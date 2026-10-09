import { afterAll, expect, test, vi } from "vitest";
import { prisma } from "../src/db.js";
import { makeApp } from "./helpers.js";
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
const isNova = (s: string) => s.includes("When the owner asks for work to be done") && !isPlan(s);
const isTask = (s: string) => s.includes("Nova assigned you a task");
type Co = Awaited<ReturnType<typeof company>>;
async function attach(co: Co, name: string, data: Buffer) {
  const boundary = "----b" + Math.random().toString(16).slice(2);
  const payload = Buffer.concat([Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${name}"\r\ncontent-type: application/octet-stream\r\n\r\n`), data, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return (await app.inject({ method: "POST", url: `/api/workspaces/${co.id}/attachments`, payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}`, cookie: co.cookie, origin: "http://localhost:3000" } })).json().id as string;
}

test("files sent with a work request reach the plan, are copied into attachments/ on Start, and companions read them", async () => {
  const co = await company(app, llm);
  let round = 0;
  llm.setScript((s, u) => {
    if (isNova(s)) return `On it.\n\n${fence({ suggest: { goal: "Build the bakery site with my logo and menu", newProject: true } })}`;
    if (isPlan(s)) return fence({ projectName: "Bakery", tasks: [{ agentId: co.others[0].id, title: "Build the page", instructions: "Use attachments/logo.png and the menu", deliverable: "d", criteria: ["c"], dependsOn: [] }] });
    if (s.includes("Pick the files")) return fence({ read: [] });
    if (s.includes("Review each task result")) return fence({ summary: "ok", verdicts: [] });
    if (isTask(s)) return ++round === 1 ? fence({ tool: "read_file", args: { path: "attachments/menu.md" } }) : u.includes("Croissant 3") ? "Used the menu." : "no menu";
    return "ok";
  });
  const ids = [await attach(co, "logo.png", PNG), await attach(co, "menu.md", Buffer.from("Croissant 3"))];
  const cid = (await co.req("POST", `/api/workspaces/${co.id}/conversations`)).json().id as string;
  await co.req("POST", `/api/workspaces/${co.id}/conversations/${cid}/messages`, { message: "Here's my logo and menu, build my site", project: { kind: "new" }, attachmentIds: ids });
  const gid = (await co.req("GET", `/api/workspaces/${co.id}/conversations/${cid}`)).json().messages.at(-1).goalId as string;
  const base = `/api/workspaces/${co.id}/goals/${gid}`;
  await waitFor(async () => (await co.req("GET", base)).json().goal, (g) => g.status === "awaiting_approval");
  expect(userOf(llm.requests.filter((q) => isPlan(systemOf(q))).at(-1)!)).toContain("attachments/menu.md (text");
  await co.req("POST", `${base}/start`);
  const done = await waitFor(async () => (await co.req("GET", base)).json().goal, (g) => g.status === "done" || g.status === "failed");
  const paths = (await prisma.projectEntry.findMany({ where: { projectId: done.projectId, kind: "file" }, select: { path: true } })).map((e) => e.path).sort();
  expect(paths).toEqual(expect.arrayContaining(["attachments/logo.png", "attachments/menu.md"]));
  expect(done.tasks[0].result).toBe("Used the menu.");
  expect(done.edits.filter((e: { note: string }) => e.note === "Your attachment").length).toBe(2);
});

test("read_file returns PDF and Office text and pictures for images in any project", async () => {
  const co = await company(app, llm);
  const pid = (await co.req("POST", `/api/workspaces/${co.id}/projects`, { name: "Docs" })).json().id as string;
  const project = await prisma.project.findUniqueOrThrow({ where: { id: pid } });
  const { addFiles } = await import("../src/files/service.js");
  const owner = (await co.req("GET", "/api/me")).json().user.id as string;
  await addFiles(pid, owner, [{ path: "logo.png", data: PNG }, { path: "notes.docx", data: (await import("./attachments-fixtures.js")).DOCX }], []);
  const { projectTools } = await import("../src/harness/tools.js");
  const tools = projectTools(project, { write: null, read: new Map() });
  const read = (path: string) => tools.find((t) => t.name === "read_file")!.run({ path } as never, new AbortController().signal);
  expect(await read("notes.docx")).toContain("Fresh bread");
  expect(await read("logo.png")).toMatchObject({ images: [{ mime: "image/png" }] });
  expect(await tools.find((t) => t.name === "search")!.run({ query: "fresh bread" } as never, new AbortController().signal)).toContain("notes.docx");
});
