import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { deviceId, Folders, reply } from "../src/device";

async function setup() {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "agent-dev-"));
  const site = path.join(data, "site");
  await fs.mkdir(site);
  await fs.writeFile(path.join(site, "index.html"), "<h1>hi</h1>");
  const make = () => new Folders(data, (abs) => fs.rm(abs));
  return { data, site, make };
}

test("this computer keeps one id", async () => {
  const { data } = await setup();
  const id = await deviceId(data);
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(await deviceId(data)).toBe(id);
});

test("opened folders are remembered after a restart, and can be forgotten", async () => {
  const { site, make } = await setup();
  const a = make();
  await a.load();
  await a.attach("p1", site);
  const b = make();
  await b.load();
  expect(b.folderOf("p1")).toBe(site);
  expect(b.projectOf(site)).toBe("p1");
  expect(b.list()).toEqual([{ projectId: "p1", folder: site }]);
  await b.forget("p1");
  const c = make();
  await c.load();
  expect(c.list()).toEqual([]);
});

test("requests are answered from the project's folder; unknown projects get an error, never a guess", async () => {
  const { site, make } = await setup();
  const folders = make();
  await folders.load();
  await folders.attach("p1", site);
  const list = await reply({ id: "1", projectId: "p1", op: "list", args: {} }, folders);
  expect(list).toMatchObject({ id: "1", ok: true, result: { entries: [{ path: "index.html", kind: "file", isText: true }] } });
  const read = await reply({ id: "2", projectId: "p1", op: "read", args: { path: "index.html" } }, folders);
  expect(Buffer.from((read.result as { base64: string }).base64, "base64").toString()).toBe("<h1>hi</h1>");
  expect(await reply({ id: "3", projectId: "p1", op: "write", args: { path: "a.md", content: "x", base: 0 } }, folders)).toMatchObject({ ok: true, result: { hash: expect.any(String) } });
  expect(await fs.readFile(path.join(site, "a.md"), "utf8")).toBe("x");
  expect(await reply({ id: "4", projectId: "p1", op: "write", args: { path: "a.md", content: "y", base: 0 } }, folders)).toMatchObject({ ok: false, error: { code: "conflict" } });
  expect(await reply({ id: "5", projectId: "nope", op: "list", args: {} }, folders)).toMatchObject({ ok: false, error: { code: "not_found" } });
  expect(await reply({ id: "6", projectId: "p1", op: "format_disk", args: {} }, folders)).toMatchObject({ ok: false, error: { code: "invalid" } });
});
