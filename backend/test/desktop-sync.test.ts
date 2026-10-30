import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, test } from "vitest";
import { syncOnce } from "../../desktop/src/sync/engine.ts";
import { LocalFolder, SKIP_DIRS } from "../../desktop/src/sync/local-folder.ts";
import { ProjectApi } from "../../desktop/src/sync/project-api.ts";
import type { LinkState } from "../../desktop/src/sync/types.ts";
import { EXCLUDED_DIRS } from "../src/files/rules.js";
import { client, makeApp, signUp } from "./helpers.js";

const app = await makeApp();
await app.listen({ port: 0, host: "127.0.0.1" });
const address = app.server.address();
const baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
afterAll(() => app.close());

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 9, 9]);

test("the desktop app skips at least every folder the server excludes", () => {
  expect(SKIP_DIRS).toEqual(expect.arrayContaining(EXCLUDED_DIRS));
});

test("two-way sync against the real API", async () => {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const workspaceId = (await req("POST", "/api/workspaces", { name: "Desk Co", template: "head-only" })).json().id as string;
  const projectId = (await req("POST", `/api/workspaces/${workspaceId}/projects`, { name: "Desk" })).json().id as string;
  const base = `/api/workspaces/${workspaceId}/projects/${projectId}`;
  await req("PUT", `${base}/files`, { path: "readme.md", content: "from the team", baseRevision: 0 });

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desk-"));
  const local = new LocalFolder(root, (abs) => fs.rm(abs));
  const api = new ProjectApi({ baseUrl, workspaceId, projectId, cookie: async () => cookie });
  const read = (p: string) => fs.readFile(path.join(root, p), "utf8");
  const content = async (p: string) => (await req("GET", `${base}/files?path=${p}`)).json().content;
  let state: LinkState = { synced: {}, deletedHere: [] };
  const round = async () => {
    const r = await syncOnce(api, local, state, Date.now());
    state = r.state;
    return r.status;
  };

  // The project's files arrive in the folder.
  expect((await round()).kind).toBe("synced");
  expect(await read("readme.md")).toBe("from the team");

  // A local edit and a new local picture reach the project.
  await fs.writeFile(path.join(root, "readme.md"), "edited here");
  await fs.mkdir(path.join(root, "img"));
  await fs.writeFile(path.join(root, "img/logo.png"), PNG);
  await round();
  expect(await content("readme.md")).toBe("edited here");
  expect(Buffer.from((await req("GET", `${base}/download?path=img/logo.png`)).rawPayload).equals(PNG)).toBe(true);

  // A save in the project arrives in the folder.
  const rev = (await req("GET", `${base}/files?path=readme.md`)).json().revision;
  await req("PUT", `${base}/files`, { path: "readme.md", content: "team again", baseRevision: rev });
  await round();
  expect(await read("readme.md")).toBe("team again");

  // Changed on both sides: the project version wins the name, mine is kept.
  const rev2 = (await req("GET", `${base}/files?path=readme.md`)).json().revision;
  await req("PUT", `${base}/files`, { path: "readme.md", content: "theirs", baseRevision: rev2 });
  await fs.writeFile(path.join(root, "readme.md"), "mine");
  const status = await round();
  expect(await read("readme.md")).toBe("theirs");
  expect(await read("readme (my copy).md")).toBe("mine");
  expect(status.conflicts).toEqual(["readme (my copy).md"]);
  expect(await content("readme.md")).toBe("theirs");

  // Nothing left to do.
  let moved = 0;
  await syncOnce(api, local, state, Date.now(), () => moved++);
  expect(moved).toBe(0);
});

test("errors map to what the sync engine understands", async () => {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const workspaceId = (await req("POST", "/api/workspaces", { name: "Err Co", template: "head-only" })).json().id as string;
  const projectId = (await req("POST", `/api/workspaces/${workspaceId}/projects`, { name: "Err" })).json().id as string;
  await expect(new ProjectApi({ baseUrl, workspaceId, projectId, cookie: async () => "" }).list()).rejects.toMatchObject({ kind: "signed-out" });
  await expect(new ProjectApi({ baseUrl: "http://127.0.0.1:1", workspaceId, projectId, cookie: async () => cookie }).list()).rejects.toMatchObject({ kind: "offline" });
  const api = new ProjectApi({ baseUrl, workspaceId, projectId, cookie: async () => cookie });
  await expect(api.save(".env", Buffer.from("S=1"), 0)).rejects.toMatchObject({ kind: "rejected" });
  await api.save("a.md", Buffer.from("1"), 0);
  await expect(api.save("a.md", Buffer.from("2"), 0)).rejects.toMatchObject({ kind: "conflict" });
  await api.remove("a.md");
  await api.remove("a.md"); // already gone is fine
  expect(await api.list()).toEqual([]);
});
