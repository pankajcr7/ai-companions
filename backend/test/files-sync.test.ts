import { createHash } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { client, makeApp, ORIGIN, signUp } from "./helpers.js";

const app = await makeApp();
afterAll(() => app.close());

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0xff]);

async function project() {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const id = (await req("POST", "/api/workspaces", { name: "Sync Co", template: "head-only" })).json().id as string;
  const pid = (await req("POST", `/api/workspaces/${id}/projects`, { name: `P${Math.random()}` })).json().id as string;
  const base = `/api/workspaces/${id}/projects/${pid}`;
  const raw = (path: string, baseRevision: number, data: Buffer, c = cookie) =>
    app.inject({ method: "PUT", url: `${base}/files/raw?path=${encodeURIComponent(path)}&baseRevision=${baseRevision}`, payload: data, headers: { cookie: c, origin: ORIGIN, "content-type": "application/octet-stream" } });
  return { req, id, base, raw };
}

test("the tree lists each file's content hash", async () => {
  const { req, base } = await project();
  await req("PUT", `${base}/files`, { path: "docs/a.md", content: "hi", baseRevision: 0 });
  const entries = (await req("GET", `${base}/tree`)).json().entries;
  expect(entries.find((e: { path: string }) => e.path === "docs/a.md").hash).toBe(sha("hi"));
  expect(entries.find((e: { path: string }) => e.path === "docs").hash).toBeNull();
});

test("raw saves create and update binary files with revision checks", async () => {
  const { req, base, raw } = await project();
  expect((await raw("img/logo.png", 0, PNG)).json()).toEqual({ revision: 1 });
  const dl = await req("GET", `${base}/download?path=img/logo.png`);
  expect(Buffer.from(dl.rawPayload).equals(PNG)).toBe(true);
  const entry = (await req("GET", `${base}/tree`)).json().entries.find((e: { path: string }) => e.path === "img/logo.png");
  expect(entry).toMatchObject({ isText: false, size: PNG.length, revision: 1, hash: sha(PNG) });

  const png2 = Buffer.concat([PNG, Buffer.from([1, 2, 3])]);
  expect((await raw("img/logo.png", 1, png2)).json()).toEqual({ revision: 2 });
  expect((await raw("img/logo.png", 1, PNG)).statusCode).toBe(409);
  expect((await raw("IMG/LOGO.png", 0, PNG)).statusCode).toBe(409);
  expect((await raw("big.bin", 0, Buffer.alloc(11 * 1024 * 1024))).statusCode).toBe(413);
  expect((await raw("node_modules/x.js", 0, Buffer.from("x"))).statusCode).toBe(400);
  expect((await raw("k.txt", 0, Buffer.from("-----BEGIN EC PRIVATE KEY-----"))).statusCode).toBe(400);
  expect((await raw(".gitkeep", 0, Buffer.alloc(0))).json()).toEqual({ revision: 1 });
  // A text file can be saved this way too, and it is marked as text.
  expect((await raw("notes.md", 0, Buffer.from("# hi"))).json()).toEqual({ revision: 1 });
  expect((await req("GET", `${base}/files?path=notes.md`)).json().content).toBe("# hi");
});

test("a viewer can't save", async () => {
  const { id, raw } = await project();
  const viewer = await signUp(app);
  const vid = (await client(app, viewer.cookie)("GET", "/api/me")).json().user.id;
  await prisma.membership.create({ data: { workspaceId: id, userId: vid, role: "viewer" } });
  expect((await raw("a.txt", 0, Buffer.from("a"), viewer.cookie)).statusCode).toBe(403);
});
