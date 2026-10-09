import { afterAll, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { cleanupAttachments } from "../src/attachments/service.js";
import { client, makeApp, signUp } from "./helpers.js";

const app = await makeApp();
afterAll(() => app.close());
const PNG = Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001", "hex");

/** Multipart body for one file (and an optional view copy). */
function form(files: { field: string; name: string; data: Buffer }[]) {
  const boundary = "----test" + Math.random().toString(16).slice(2);
  const parts = files.map((f) => Buffer.concat([Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="${f.field}"; filename="${f.name}"\r\ncontent-type: application/octet-stream\r\n\r\n`), f.data, Buffer.from("\r\n")]));
  return { payload: Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
async function setup() {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const id = (await req("POST", "/api/workspaces", { name: "Att Co", template: "starter" })).json().id as string;
  const upload = (files: { field: string; name: string; data: Buffer }[]) => {
    const f = form(files);
    return app.inject({ method: "POST", url: `/api/workspaces/${id}/attachments`, payload: f.payload, headers: { ...f.headers, cookie, origin: "http://localhost:3000" } });
  };
  return { req, id, cookie, upload };
}

test("upload: type from bytes, text extracted, content served safely, only to the uploader", async () => {
  const a = await setup();
  const up = await a.upload([{ field: "file", name: "notes.md", data: Buffer.from("# Menu\nCroissant 3") }]);
  expect(up.statusCode).toBe(200);
  const att = up.json();
  expect(att).toMatchObject({ name: "notes.md", kind: "text", size: 18 });
  expect((await prisma.attachment.findUniqueOrThrow({ where: { id: att.id } })).text).toBe("# Menu\nCroissant 3");
  const content = await a.req("GET", `/api/workspaces/${a.id}/attachments/${att.id}/content`);
  expect(content.headers["x-content-type-options"]).toBe("nosniff");
  const svg = (await a.upload([{ field: "file", name: "logo.svg", data: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") }])).json();
  expect((await a.req("GET", `/api/workspaces/${a.id}/attachments/${svg.id}/content`)).headers["content-disposition"]).toMatch(/^attachment/);
  const img = (await a.upload([{ field: "file", name: "logo.png", data: PNG }, { field: "view", name: "logo.webp", data: PNG }])).json();
  expect(img).toMatchObject({ kind: "image", mime: "image/png" });
  expect((await prisma.attachment.findUniqueOrThrow({ where: { id: img.id } })).viewHash).toBeTruthy();

  const other = await setup();
  expect((await other.req("GET", `/api/workspaces/${a.id}/attachments/${att.id}`)).statusCode).toBeGreaterThanOrEqual(403);
});

test("limits: over 10 MB and unknown types are refused with plain messages", async () => {
  const a = await setup();
  const big = await a.upload([{ field: "file", name: "menu.pdf", data: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(10 * 1024 * 1024 + 1)]) }]);
  expect(big.statusCode).toBe(413);
  expect(big.json().error.message).toBe("menu.pdf is over 10 MB");
  const odd = await a.upload([{ field: "file", name: "blob.bin", data: Buffer.from([0, 1, 2, 0, 255]) }]);
  expect(odd.statusCode).toBe(415);
  expect(odd.json().error.message).toBe("This file type isn't supported yet");
});

test("save to project copies with a numbered name on a clash; unsent uploads are cleaned after a day", async () => {
  const a = await setup();
  const pid = (await a.req("POST", `/api/workspaces/${a.id}/projects`, { name: "Site" })).json().id as string;
  const img = (await a.upload([{ field: "file", name: "logo.png", data: PNG }])).json();
  expect((await a.req("POST", `/api/workspaces/${a.id}/attachments/${img.id}/save`, { projectId: pid })).json()).toEqual({ path: "attachments/logo.png" });
  expect((await a.req("POST", `/api/workspaces/${a.id}/attachments/${img.id}/save`, { projectId: pid })).json()).toEqual({ path: "attachments/logo (2).png" });
  await prisma.attachment.update({ where: { id: img.id }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
  expect(await cleanupAttachments()).toBeGreaterThanOrEqual(1);
  expect(await prisma.attachment.findUnique({ where: { id: img.id } })).toBeNull();
});
