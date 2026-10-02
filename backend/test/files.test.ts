import { afterAll, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { client, makeApp, ORIGIN, signUp } from "./helpers.js";
import { multipart } from "./upload-helpers.js";

const app = await makeApp();
afterAll(() => app.close());

async function project(files: [string, string][] = [["src/app.ts", "const a = 1;\n"]]) {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const id = (await req("POST", "/api/workspaces", { name: "Edit Co", template: "head-only" })).json().id as string;
  const body = multipart({ name: `P${Math.random()}`, source: "folder" }, files.map(([p, c]) => [p, p.split("/").pop()!, c]));
  const pid = (await app.inject({ method: "POST", url: `/api/workspaces/${id}/projects/upload`, payload: body.payload, headers: { ...body.headers, cookie, origin: ORIGIN } })).json().projectId;
  const base = `/api/workspaces/${id}/projects/${pid}`;
  const tree = async () => (await req("GET", `${base}/tree`)).json().entries.map((e: { path: string }) => e.path);
  return { req, id, pid, base, tree };
}

test("read, save with revision bump, and history", async () => {
  const { req, base } = await project();
  const file = (await req("GET", `${base}/files?path=src/app.ts`)).json();
  expect(file).toEqual({ path: "src/app.ts", content: "const a = 1;\n", revision: 1 });
  const saved = await req("PUT", `${base}/files`, { path: "src/app.ts", content: "const a = 2;\n", baseRevision: 1 });
  expect(saved.json()).toEqual({ revision: 2 });
  expect((await req("GET", `${base}/files?path=src/app.ts`)).json().content).toBe("const a = 2;\n");
  const history = (await req("GET", `${base}/history?path=src/app.ts`)).json().revisions;
  expect(history.map((h: { revision: number; reason: string }) => [h.revision, h.reason])).toEqual([
    [2, "edit"],
    [1, "upload"],
  ]);
});

test("a stale save is refused with 409 and changes nothing", async () => {
  const { req, base } = await project();
  await req("PUT", `${base}/files`, { path: "src/app.ts", content: "mine", baseRevision: 1 });
  const stale = await req("PUT", `${base}/files`, { path: "src/app.ts", content: "theirs", baseRevision: 1 });
  expect(stale.statusCode).toBe(409);
  expect(stale.json().error.message).toMatch(/changed since you opened it/);
  expect((await req("GET", `${base}/files?path=src/app.ts`)).json().content).toBe("mine");
});

test("new files via save, folders, and validation", async () => {
  const { req, base, tree } = await project();
  expect((await req("PUT", `${base}/files`, { path: "docs/guide/intro.md", content: "# Hi", baseRevision: 0 })).json()).toEqual({ revision: 1 });
  expect((await req("PUT", `${base}/files`, { path: "SRC/APP.ts", content: "dup", baseRevision: 0 })).statusCode).toBe(409);
  expect((await req("PUT", `${base}/files`, { path: ".env", content: "S=1", baseRevision: 0 })).statusCode).toBe(400);
  expect((await req("PUT", `${base}/files`, { path: "k.txt", content: "-----BEGIN EC PRIVATE KEY-----", baseRevision: 0 })).statusCode).toBe(400);
  expect((await req("PUT", `${base}/files`, { path: "big.txt", content: "x".repeat(1024 * 1024 + 1), baseRevision: 0 })).statusCode).toBe(413);
  expect((await req("POST", `${base}/folders`, { path: "assets/img" })).statusCode).toBe(201);
  expect(await tree()).toEqual(["assets", "assets/img", "docs", "docs/guide", "docs/guide/intro.md", "src", "src/app.ts"]);
});

test("move a file and a folder with children; refuse moving into itself or onto an existing path", async () => {
  const { req, base, tree } = await project([["src/a.ts", "a"], ["src/lib/b.ts", "b"], ["other.ts", "o"]]);
  expect((await req("POST", `${base}/move`, { from: "other.ts", to: "src/other.ts" })).statusCode).toBe(200);
  expect((await req("POST", `${base}/move`, { from: "src", to: "app" })).statusCode).toBe(200);
  expect(await tree()).toEqual(["app", "app/a.ts", "app/lib", "app/lib/b.ts", "app/other.ts"]);
  expect((await req("POST", `${base}/move`, { from: "app", to: "app/lib/app" })).statusCode).toBe(400);
  expect((await req("POST", `${base}/move`, { from: "app/a.ts", to: "app/other.ts" })).statusCode).toBe(409);
  expect((await req("GET", `${base}/files?path=app/lib/b.ts`)).json().content).toBe("b");
  const rev = (await req("GET", `${base}/history?path=app/other.ts`)).json().revisions[0];
  expect(rev).toMatchObject({ reason: "rename", fromPath: "other.ts" });
});

test("delete a folder removes its children and updates counts", async () => {
  const { req, pid, base, tree } = await project([["src/a.ts", "a"], ["src/lib/b.ts", "b"], ["keep.md", "k"]]);
  expect((await req("DELETE", `${base}/entries?path=src`)).statusCode).toBe(204);
  expect(await tree()).toEqual(["keep.md"]);
  expect(await prisma.project.findUniqueOrThrow({ where: { id: pid } })).toMatchObject({ fileCount: 1, totalBytes: 1 });
});

test("view and restore an old version", async () => {
  const { req, base } = await project();
  await req("PUT", `${base}/files`, { path: "src/app.ts", content: "v2", baseRevision: 1 });
  const v1 = (await req("GET", `${base}/history?path=src/app.ts`)).json().revisions.find((r: { revision: number }) => r.revision === 1);
  expect((await req("GET", `${base}/history/${v1.id}`)).json().content).toBe("const a = 1;\n");
  expect((await req("POST", `${base}/restore`, { path: "src/app.ts", revisionId: v1.id })).json()).toEqual({ revision: 3 });
  expect((await req("GET", `${base}/files?path=src/app.ts`)).json()).toMatchObject({ content: "const a = 1;\n", revision: 3 });
});

test("binary files can't be opened as text; viewers can't edit; other workspaces get 404", async () => {
  const { req, id, base } = await project([["logo.png", "\u0000\u0001PNG"]]);
  expect((await req("GET", `${base}/files?path=logo.png`)).statusCode).toBe(415);
  const viewer = await signUp(app);
  const vid = (await client(app, viewer.cookie)("GET", "/api/me")).json().user.id;
  await prisma.membership.create({ data: { workspaceId: id, userId: vid, role: "viewer" } });
  expect((await client(app, viewer.cookie)("PUT", `${base}/files`, { path: "x.txt", content: "x", baseRevision: 0 })).statusCode).toBe(403);
  const stranger = client(app, (await signUp(app)).cookie);
  expect((await stranger("GET", `${base}/files?path=logo.png`)).statusCode).toBe(404);
});

test("deleting a folder leaves sibling folders whose names differ at _ or % alone", async () => {
  const { req, base, tree } = await project([["a_b/x.ts", "x"], ["a-b/y.ts", "y"], ["axb/z.ts", "z"], ["100%/p.ts", "p"], ["100x/q.ts", "q"]]);
  expect((await req("DELETE", `${base}/entries?path=a_b`)).statusCode).toBe(204);
  expect((await req("DELETE", `${base}/entries?path=100%25`)).statusCode).toBe(204);
  expect(await tree()).toEqual(["100x", "100x/q.ts", "a-b", "a-b/y.ts", "axb", "axb/z.ts"]);
});

test("renaming a folder whose name has an emoji keeps its children inside", async () => {
  const { req, base, tree } = await project([["📁n/a.txt", "a"], ["İx/b.txt", "b"]]);
  expect((await req("POST", `${base}/move`, { from: "📁n", to: "new" })).statusCode).toBe(200);
  expect((await req("POST", `${base}/move`, { from: "İx", to: "done" })).statusCode).toBe(200);
  expect(await tree()).toEqual(["done", "done/b.txt", "new", "new/a.txt"]);
  expect((await req("GET", `${base}/files?path=NEW/A.TXT`)).json().content).toBe("a");
});
