import { unzipSync } from "fflate";
import { afterAll, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { putBlob } from "../src/files/store.js";
import { client, makeApp, signUp } from "./helpers.js";

const app = await makeApp();
afterAll(() => app.close());

async function owner() {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const id = (await req("POST", "/api/workspaces", { name: "Files Co", template: "head-only" })).json().id as string;
  return { req, id, cookie };
}

async function seedFile(projectId: string, path: string, content: string | Buffer, userId: string) {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const blobHash = await putBlob(data);
  await prisma.projectEntry.create({ data: { projectId, path, pathLower: path.toLowerCase(), kind: "file", blobHash, size: data.length, isText: !Buffer.isBuffer(content), revision: 1, updatedById: userId } });
}

test("create, list, rename, and duplicate names", async () => {
  const { req, id } = await owner();
  const created = await req("POST", `/api/workspaces/${id}/projects`, { name: "Bakery site" });
  expect(created.statusCode).toBe(201);
  expect((await req("POST", `/api/workspaces/${id}/projects`, { name: "Bakery site" })).statusCode).toBe(409);
  const pid = created.json().id;
  expect((await req("PATCH", `/api/workspaces/${id}/projects/${pid}`, { name: "Bakery web" })).statusCode).toBe(200);
  const list = (await req("GET", `/api/workspaces/${id}/projects`)).json().projects;
  expect(list).toMatchObject([{ id: pid, name: "Bakery web", fileCount: 0, totalBytes: 0 }]);
});

test("tree lists entries; downloads send safe headers", async () => {
  const { req, id } = await owner();
  const pid = (await req("POST", `/api/workspaces/${id}/projects`, { name: "P" })).json().id;
  const me = (await req("GET", "/api/me")).json().user.id;
  await seedFile(pid, "src/index.html", "<script>alert(1)</script>", me);
  await seedFile(pid, "logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), me);
  await prisma.projectEntry.create({ data: { projectId: pid, path: "src", pathLower: "src", kind: "dir", updatedById: me } });
  const tree = (await req("GET", `/api/workspaces/${id}/projects/${pid}/tree`)).json().entries;
  expect(tree.map((e: { path: string; kind: string }) => [e.path, e.kind])).toEqual([
    ["logo.png", "file"],
    ["src", "dir"],
    ["src/index.html", "file"],
  ]);
  const html = await req("GET", `/api/workspaces/${id}/projects/${pid}/download?path=src/index.html`);
  expect(html.headers["content-disposition"]).toMatch(/^attachment;/);
  expect(html.headers["x-content-type-options"]).toBe("nosniff");
  expect(html.headers["content-security-policy"]).toBe("sandbox");
  expect(html.headers["content-type"]).toMatch(/application\/octet-stream/);
  const png = await req("GET", `/api/workspaces/${id}/projects/${pid}/download?path=logo.png`);
  expect(png.headers["content-type"]).toBe("image/png");
  expect(png.headers["content-disposition"]).toMatch(/^inline;/);
});

test("download.zip contains every file with its structure", async () => {
  const { req, id } = await owner();
  const pid = (await req("POST", `/api/workspaces/${id}/projects`, { name: "Zip me" })).json().id;
  const me = (await req("GET", "/api/me")).json().user.id;
  await seedFile(pid, "a/b/c.txt", "deep", me);
  await prisma.projectEntry.create({ data: { projectId: pid, path: "empty", pathLower: "empty", kind: "dir", updatedById: me } });
  const res = await req("GET", `/api/workspaces/${id}/projects/${pid}/download.zip`);
  expect(res.headers["content-disposition"]).toMatch(/Zip%20me\.zip|Zip me\.zip/);
  const files = unzipSync(new Uint8Array(res.rawPayload));
  expect(Buffer.from(files["a/b/c.txt"]).toString()).toBe("deep");
  expect("empty/" in files).toBe(true);
});

test("bad paths are rejected and other workspaces get 404", async () => {
  const a = await owner();
  const b = await owner();
  const pid = (await a.req("POST", `/api/workspaces/${a.id}/projects`, { name: "Mine" })).json().id;
  expect((await a.req("GET", `/api/workspaces/${a.id}/projects/${pid}/download?path=../x`)).statusCode).toBe(400);
  expect((await b.req("GET", `/api/workspaces/${b.id}/projects/${pid}/tree`)).statusCode).toBe(404);
  expect((await b.req("GET", `/api/workspaces/${a.id}/projects/${pid}/tree`)).statusCode).toBe(404);
});

test("roles: member cannot delete a project, owner can", async () => {
  const { req, id } = await owner();
  const pid = (await req("POST", `/api/workspaces/${id}/projects`, { name: "Doomed" })).json().id;
  const member = await signUp(app);
  const mid = (await client(app, member.cookie)("GET", "/api/me")).json().user.id;
  await prisma.membership.create({ data: { workspaceId: id, userId: mid, role: "member" } });
  expect((await client(app, member.cookie)("DELETE", `/api/workspaces/${id}/projects/${pid}`)).statusCode).toBe(403);
  expect((await req("DELETE", `/api/workspaces/${id}/projects/${pid}`)).statusCode).toBe(204);
});
