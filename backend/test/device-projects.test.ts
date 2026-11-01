import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, test } from "vitest";
import { Device, deviceId, Folders } from "../../desktop/src/device.ts";
import { prisma } from "../src/db.js";
import { goalContext } from "../src/goals/load.js";
import { saveText } from "../src/files/service.js";
import { projectTools } from "../src/harness/tools.js";
import { client, makeApp, ORIGIN, signUp } from "./helpers.js";
import { multipart } from "./upload-helpers.js";

const app = await makeApp();
await app.listen({ port: 0, host: "127.0.0.1" });
const address = app.server.address();
const baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
const running: Device[] = [];
afterAll(async () => {
  for (const d of running) d.stop();
  await app.close();
});

/** A signed-in owner whose desktop app holds `files` in a folder opened as a project. */
async function deviceProject(files: Record<string, string> = {}) {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const workspaceId = (await req("POST", "/api/workspaces", { name: "Folder Co", template: "head-only" })).json().id as string;
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "agent-devproj-"));
  const site = path.join(data, "site");
  await fs.mkdir(site);
  for (const [p, d] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(site, p)), { recursive: true });
    await fs.writeFile(path.join(site, p), d);
  }
  const trashed: string[] = [];
  const folders = new Folders(data, async (abs) => {
    trashed.push(abs);
    await fs.rm(abs, { recursive: true });
  });
  const id = await deviceId(data);
  const created = await req("POST", `/api/workspaces/${workspaceId}/projects`, { name: "site", deviceId: id });
  expect(created.statusCode).toBe(201);
  const pid = created.json().id as string;
  await folders.attach(pid, site);
  const device = new Device({ baseUrl, id, cookie: async () => cookie, folders, active: () => true, wait: 1 });
  running.push(device);
  void device.run();
  const base = `/api/workspaces/${workspaceId}/projects/${pid}`;
  // Connected once the tree comes from the folder rather than "open the app".
  for (let i = 0; i < 50 && (await req("GET", `${base}/tree`)).json().unreachable; i++) await new Promise((r) => setTimeout(r, 100));
  const disk = (p: string) => fs.readFile(path.join(site, p), "utf8");
  return { req, cookie, workspaceId, pid, base, site, disk, trashed, project: await prisma.project.findUniqueOrThrow({ where: { id: pid } }) };
}

test("tree, editor read and save work on the folder, and nothing is stored on the server", async () => {
  const { req, base, pid, disk } = await deviceProject({ "index.html": "<h1>Hi</h1>", "src/app.js": "let a = 1;" });
  const tree = (await req("GET", `${base}/tree`)).json();
  expect(tree.project.onDevice).toBe(true);
  expect(tree.entries.map((e: { path: string }) => e.path)).toEqual(["index.html", "src", "src/app.js"]);
  const file = (await req("GET", `${base}/files?path=src/app.js`)).json();
  expect(file.content).toBe("let a = 1;");
  const saved = await req("PUT", `${base}/files`, { path: "src/app.js", content: "let a = 2;", baseRevision: file.revision });
  expect(saved.statusCode).toBe(200);
  expect(await disk("src/app.js")).toBe("let a = 2;");
  expect((await req("PUT", `${base}/files`, { path: "notes/new.md", content: "# New", baseRevision: 0 })).statusCode).toBe(200);
  expect(await disk("notes/new.md")).toBe("# New");
  expect(await prisma.projectEntry.count({ where: { projectId: pid } })).toBe(0);
  expect(await prisma.fileRevision.count({ where: { projectId: pid } })).toBe(0);
});

test("an edit made on the computer is never overwritten by an older copy", async () => {
  const { req, base, site, disk } = await deviceProject({ "a.md": "one" });
  const file = (await req("GET", `${base}/files?path=a.md`)).json();
  await fs.writeFile(path.join(site, "a.md"), "edited in VS Code");
  const stale = await req("PUT", `${base}/files`, { path: "a.md", content: "older copy", baseRevision: file.revision });
  expect(stale.statusCode).toBe(409);
  expect(await disk("a.md")).toBe("edited in VS Code");
});

test("the team's tools list, read, search and write the folder", async () => {
  const { project, disk } = await deviceProject({ "index.html": "<title>Bakery</title>", "css/site.css": "body { color: red; }" });
  const tools = projectTools(project, { write: async (w) => (await saveText(project, project.createdById, w.path, w.content, w.baseRevision), `Saved ${w.path}.`), read: new Map() });
  const run = (name: string, args: object) => tools.find((t) => t.name === name)!.run(args as never, new AbortController().signal);
  expect(await run("list_files", {})).toContain("css/site.css");
  expect(await run("read_file", { path: "index.html" })).toBe("<title>Bakery</title>");
  expect(await run("search", { query: "color" })).toBe("css/site.css:1: body { color: red; }");
  expect(await run("write_file", { path: "index.html", content: "<title>Bread</title>" })).toBe("Saved index.html.");
  expect(await disk("index.html")).toBe("<title>Bread</title>");
});

test("the team's briefing reads the brief from the folder", async () => {
  const { project } = await deviceProject({ ".company/brief.md": "Sell sourdough." });
  expect((await goalContext(project)).shared).toContain("Sell sourdough.");
});

test("preview serves pages and the app builder from the folder", async () => {
  const { req, base } = await deviceProject({ "index.html": "<h1>Fresh bread</h1>", "style.css": "h1{}", "accounts.sqlite": "private" });
  const { url } = (await req("POST", `${base}/preview-token`, {})).json();
  expect((await app.inject({ method: "GET", url })).body).toBe("<h1>Fresh bread</h1>");
  // A preview link reaches the folder's web files, not everything in it.
  expect((await app.inject({ method: "GET", url: url.replace("index.html", "style.css") })).statusCode).toBe(200);
  expect((await app.inject({ method: "GET", url: url.replace("index.html", "accounts.sqlite") })).statusCode).toBe(404);

  const appProject = await deviceProject({ "package.json": JSON.stringify({ dependencies: { react: "19" } }), "src/main.jsx": "export default () => <p>App</p>;" });
  const token = (await appProject.req("POST", `${appProject.base}/preview-token`, {})).json();
  expect(token.entry).toBe("__app__");
  expect((await app.inject({ method: "GET", url: token.url })).body).toContain("export default () =>");
});

test("history lists the versions kept before each change and restores one", async () => {
  const { req, base, disk } = await deviceProject({ "a.md": "first" });
  const rev = (await req("GET", `${base}/files?path=a.md`)).json().revision;
  await req("PUT", `${base}/files`, { path: "a.md", content: "second", baseRevision: rev });
  const { revisions } = (await req("GET", `${base}/history?path=a.md`)).json();
  expect(revisions).toHaveLength(2);
  expect((await req("GET", `${base}/history/${revisions[1].id}`)).json().content).toBe("first");
  expect((await req("POST", `${base}/restore`, { path: "a.md", revisionId: revisions[1].id })).statusCode).toBe(200);
  expect(await disk("a.md")).toBe("first");
});

test("new folders, renames and deletes happen in the folder; deletes go to the trash", async () => {
  const { req, base, site, disk, trashed } = await deviceProject({ "old.md": "o", "gone.md": "g" });
  expect((await req("POST", `${base}/folders`, { path: "assets/img" })).statusCode).toBe(201);
  expect((await fs.stat(path.join(site, "assets/img"))).isDirectory()).toBe(true);
  expect((await req("POST", `${base}/move`, { from: "old.md", to: "docs/new.md" })).statusCode).toBe(200);
  expect(await disk("docs/new.md")).toBe("o");
  expect((await req("DELETE", `${base}/entries?path=gone.md`)).statusCode).toBe(204);
  expect(trashed).toEqual([path.join(site, "gone.md")]);
});

test("uploading into the project and the ZIP download point to the folder instead", async () => {
  const { req, base, cookie } = await deviceProject({ "a.md": "a" });
  expect((await req("GET", `${base}/download.zip`)).statusCode).toBe(400);
  const upload = await app.inject({ method: "POST", url: `${base}/upload`, headers: { cookie, origin: ORIGIN, "content-type": "multipart/form-data; boundary=x" }, payload: "--x--\r\n" });
  expect(upload.statusCode).toBe(400);
});

test("another member can't reach the owner's folder", async () => {
  const { workspaceId, base } = await deviceProject({ "a.md": "a" });
  const other = await signUp(app);
  const oid = (await client(app, other.cookie)("GET", "/api/me")).json().user.id;
  await prisma.membership.create({ data: { workspaceId, userId: oid, role: "member" } });
  const res = await client(app, other.cookie)("GET", `${base}/tree`);
  expect(res.statusCode).toBe(403);
  expect(res.json().error.message).toMatch(/another person's computer/);
});

test("when the app isn't open, the page says to open it", async () => {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const workspaceId = (await req("POST", "/api/workspaces", { name: "Closed Co", template: "head-only" })).json().id as string;
  const pid = (await req("POST", `/api/workspaces/${workspaceId}/projects`, { name: "site", deviceId: "never-polled-device" })).json().id as string;
  // The project page still gets the project, with what to do instead of the files.
  const tree = await req("GET", `/api/workspaces/${workspaceId}/projects/${pid}/tree`);
  expect(tree.statusCode, tree.body).toBe(200);
  expect(tree.json()).toMatchObject({ project: { name: "site", onDevice: true }, entries: [], unreachable: "Open the Agent Company app on the computer that has this folder." });
  const file = await req("GET", `/api/workspaces/${workspaceId}/projects/${pid}/files?path=a.md`);
  expect(file.statusCode).toBe(409);
  expect(file.json().error.message).toBe("Open the Agent Company app on the computer that has this folder.");
});

test("another member can't run or change the owner's goals on a folder, or save files into it", async () => {
  const { workspaceId, project, site } = await deviceProject({ "a.md": "a" });
  const other = await signUp(app);
  const oreq = client(app, other.cookie);
  const oid = (await oreq("GET", "/api/me")).json().user.id;
  await prisma.membership.create({ data: { workspaceId, userId: oid, role: "member" } });
  const goal = await prisma.goal.create({ data: { workspaceId, projectId: project.id, text: "Tidy the site", status: "awaiting_approval", createdById: project.createdById } });
  const g = `/api/workspaces/${workspaceId}/goals/${goal.id}`;
  const tries = [
    await oreq("PUT", `${g}/plan`, { tasks: [] }),
    await oreq("POST", `${g}/start`),
    await oreq("POST", `${g}/resume`),
    await oreq("POST", `${g}/replan`),
    await oreq("POST", `${g}/tasks/nope/retry`),
  ];
  expect(tries.map((r) => r.statusCode)).toEqual([403, 403, 403, 403, 403]);
  const f = multipart({}, [["file", "note.txt", "from someone else"]]);
  const att = (await app.inject({ method: "POST", url: `/api/workspaces/${workspaceId}/attachments`, payload: f.payload, headers: { ...f.headers, cookie: other.cookie, origin: ORIGIN } })).json();
  const saved = await oreq("POST", `/api/workspaces/${workspaceId}/attachments/${att.id}/save`, { projectId: project.id });
  expect(saved.statusCode).toBe(403);
  await expect(fs.stat(path.join(site, "attachments"))).rejects.toThrow();
});
