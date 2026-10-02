import { strToU8, zipSync } from "fflate";
import { afterAll, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { client, makeApp, ORIGIN, signUp } from "./helpers.js";
import { multipart } from "./upload-helpers.js";

const app = await makeApp();
afterAll(() => app.close());

async function owner() {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const id = (await req("POST", "/api/workspaces", { name: "Upload Co", template: "head-only" })).json().id as string;
  const upload = (url: string, fields: Record<string, string>, files: [string, string, Buffer | string][]) => {
    const body = multipart(fields, files);
    return app.inject({ method: "POST", url, payload: body.payload, headers: { ...body.headers, cookie, origin: ORIGIN } });
  };
  return { req, id, upload };
}
const paths = async (req: ReturnType<typeof client>, id: string, pid: string) =>
  (await req("GET", `/api/workspaces/${id}/projects/${pid}/tree`)).json().entries.map((e: { path: string; kind: string }) => `${e.kind}:${e.path}`);

test("folder upload creates a project with nesting, parent folders, and empty folders", async () => {
  const { req, id, upload } = await owner();
  const res = await upload(`/api/workspaces/${id}/projects/upload`, { name: "Sample app", source: "folder", dirs: JSON.stringify(["sample/assets/empty"]) }, [
    ["sample/package.json", "package.json", '{"name":"x"}'],
    ["sample/src/app/page.tsx", "page.tsx", "export default function Page() {}"],
  ]);
  expect(res.statusCode).toBe(201);
  const { projectId, added, skipped } = res.json();
  expect({ added, skipped }).toEqual({ added: 2, skipped: [] });
  expect(await paths(req, id, projectId)).toEqual([
    "dir:sample",
    "dir:sample/assets",
    "dir:sample/assets/empty",
    "file:sample/package.json",
    "dir:sample/src",
    "dir:sample/src/app",
    "file:sample/src/app/page.tsx",
  ]);
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  expect(project).toMatchObject({ name: "Sample app", fileCount: 2 });
  const rev = await prisma.fileRevision.findFirstOrThrow({ where: { projectId } });
  expect(rev).toMatchObject({ reason: "upload", revision: 1 });
});

test("excluded, secret, unsafe, and colliding files are skipped with reasons", async () => {
  const { id, upload } = await owner();
  const res = await upload(`/api/workspaces/${id}/projects/upload`, { name: "Rules", source: "folder" }, [
    ["app/node_modules/x/index.js", "index.js", "x"],
    ["app/.env", ".env", "SECRET=1"],
    ["app/.env.example", ".env.example", "SECRET="],
    ["app/notes/key.txt", "key.txt", "-----BEGIN RSA PRIVATE KEY-----\nabc"],
    ["../escape.txt", "escape.txt", "x"],
    ["app/Readme.md", "Readme.md", "a"],
    ["app/README.md", "README.md", "b"],
  ]);
  const { added, skipped } = res.json();
  expect(added).toBe(2);
  const reasons = Object.fromEntries(skipped.map((s: { path: string; reason: string }) => [s.path, s.reason]));
  expect(reasons["app/node_modules/x/index.js"]).toMatch(/node_modules/);
  expect(reasons["app/.env"]).toMatch(/secret/);
  expect(reasons["app/notes/key.txt"]).toMatch(/private key/);
  expect(reasons["../escape.txt"]).toMatch(/invalid/);
  expect(reasons["app/README.md"]).toMatch(/already exists|same name/);
});

test("uploading into an existing project never overwrites (any letter case)", async () => {
  const { req, id, upload } = await owner();
  const pid = (await req("POST", `/api/workspaces/${id}/projects`, { name: "Existing" })).json().id;
  await upload(`/api/workspaces/${id}/projects/${pid}/upload`, { source: "files" }, [["notes.txt", "notes.txt", "first"]]);
  const res = await upload(`/api/workspaces/${id}/projects/${pid}/upload`, { source: "files" }, [["NOTES.txt", "NOTES.txt", "second"]]);
  expect(res.json().added).toBe(0);
  expect(res.json().skipped[0].reason).toMatch(/already exists/);
  const entry = await prisma.projectEntry.findFirstOrThrow({ where: { projectId: pid } });
  expect(entry.path).toBe("notes.txt");
});

test("ZIP upload unpacks safely", async () => {
  const { req, id, upload } = await owner();
  const zip = Buffer.from(zipSync({ "site/index.html": strToU8("<h1>Hi</h1>"), "site/img/": new Uint8Array(), "site/.git/HEAD": strToU8("ref") }));
  const res = await upload(`/api/workspaces/${id}/projects/upload`, { name: "Zipped", source: "zip" }, [["zip", "site.zip", zip]]);
  expect(res.statusCode).toBe(201);
  expect(await paths(req, id, res.json().projectId)).toEqual(["dir:site", "dir:site/img", "file:site/index.html"]);
  expect(res.json().skipped.map((s: { reason: string }) => s.reason)).toEqual([expect.stringMatching(/\.git/)]);
});

test("a bad ZIP on a new project leaves no empty project behind", async () => {
  const { id, upload } = await owner();
  const res = await upload(`/api/workspaces/${id}/projects/upload`, { name: "Broken zip", source: "zip" }, [["zip", "bad.zip", Buffer.from("PK\u0003\u0004nope")]]);
  expect(res.statusCode).toBe(400);
  expect(await prisma.project.count({ where: { workspaceId: id } })).toBe(0);
});

test("cancelling a new-project import that added nothing deletes the project", async () => {
  const { req, id, upload } = await owner();
  const res = await upload(`/api/workspaces/${id}/projects/upload`, { name: "Cancelled", source: "folder" }, [["x/.env", ".env", "S=1"]]);
  const { projectId, importId } = res.json();
  const fin = await req("POST", `/api/workspaces/${id}/projects/${projectId}/imports/${importId}/finish`, { status: "cancelled" });
  expect(fin.json()).toEqual({ deletedProject: true });
  expect(await prisma.project.count({ where: { id: projectId } })).toBe(0);
});

test("files over 10 MB are skipped, and viewers can't upload", async () => {
  const { id, upload } = await owner();
  const res = await upload(`/api/workspaces/${id}/projects/upload`, { name: "Big", source: "files" }, [
    ["big.bin", "big.bin", Buffer.alloc(10 * 1024 * 1024 + 1)],
    ["ok.txt", "ok.txt", "fine"],
  ]);
  expect(res.json().added).toBe(1);
  expect(res.json().skipped[0]).toMatchObject({ path: "big.bin", reason: expect.stringMatching(/larger than 10 MB/) });
  const viewer = await signUp(app);
  const vid = (await client(app, viewer.cookie)("GET", "/api/me")).json().user.id;
  await prisma.membership.create({ data: { workspaceId: id, userId: vid, role: "viewer" } });
  const body = multipart({ name: "Nope", source: "files" }, [["a.txt", "a.txt", "a"]]);
  const denied = await app.inject({ method: "POST", url: `/api/workspaces/${id}/projects/upload`, payload: body.payload, headers: { ...body.headers, cookie: viewer.cookie, origin: ORIGIN } });
  expect(denied.statusCode).toBe(403);
});
