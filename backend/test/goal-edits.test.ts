import { afterAll, expect, test, vi } from "vitest";
import { prisma } from "../src/db.js";
import { client, makeApp, ORIGIN, signUp } from "./helpers.js";
import { company, fakeLLM, fence, waitFor } from "./goal-helpers.js";
import { multipart } from "./upload-helpers.js";

// Each test builds whole companies at remote-database latency.
vi.setConfig({ testTimeout: 240_000 });
const llm = await fakeLLM();
const app = await makeApp();
afterAll(async () => {
  await llm.close();
  await app.close();
});

async function goalWithEdits(edits: { path: string; content: string }[], read: string[]) {
  const co = await company(app, llm);
  const body = multipart({ name: `P${Math.random()}`, source: "folder" }, [["src/app.ts", "app.ts", "v1"], ["notes.md", "notes.md", "n1"]]);
  const pid = (await app.inject({ method: "POST", url: `/api/workspaces/${co.id}/projects/upload`, payload: body.payload, headers: { ...body.headers, cookie: co.cookie, origin: ORIGIN } })).json().projectId as string;
  llm.setScript((s) =>
    s.includes("Turn the owner's goal into a plan")
      ? fence({ tasks: [{ agentId: co.others[0].id, title: "edit", instructions: "edit", deliverable: "files", criteria: ["ok"], dependsOn: [] }] })
      : s.includes("Pick the files you need to read")
        ? fence({ read })
        : s.includes("Review each task result")
          ? fence({ summary: "ok", verdicts: [] })
          : `Done.\n${fence({ edits })}`,
  );
  const gid = (await co.req("POST", `/api/workspaces/${co.id}/goals`, { text: "Edit", projectId: pid })).json().id as string;
  const base = `/api/workspaces/${co.id}/goals/${gid}`;
  const get = async () => (await co.req("GET", base)).json().goal;
  await waitFor(get, (g) => g.status === "awaiting_approval");
  await co.req("POST", `${base}/start`);
  const g = await waitFor(get, (x) => x.status === "done");
  return { ...co, pid, base, edits: g.edits as { id: string; path: string; status: string }[], files: `/api/workspaces/${co.id}/projects/${pid}` };
}

test("view and apply an edit; the file gets a new version", async () => {
  const co = await goalWithEdits([{ path: "src/app.ts", content: "v2" }, { path: "docs/new.md", content: "# New" }], ["src/app.ts"]);
  const view = (await co.req("GET", `${co.base}/edits/${co.edits[0].id}`)).json().edit;
  expect(view).toMatchObject({ path: "src/app.ts", content: "v2", current: "v1", baseRevision: 1, status: "pending" });
  expect((await co.req("GET", `${co.base}/edits/${co.edits[1].id}`)).json().edit.current).toBeNull();
  expect((await co.req("POST", `${co.base}/edits/${co.edits[0].id}/apply`)).json()).toEqual({ revision: 2 });
  expect((await co.req("GET", `${co.files}/files?path=src/app.ts`)).json()).toMatchObject({ content: "v2", revision: 2 });
  expect((await co.req("POST", `${co.base}/edits/${co.edits[1].id}/apply`)).json()).toEqual({ revision: 1 });
  expect((await co.req("POST", `${co.base}/edits/${co.edits[0].id}/apply`)).statusCode).toBe(409);
  const after = (await co.req("GET", co.base)).json().goal.edits.map((e: { status: string }) => e.status);
  expect(after).toEqual(["applied", "applied"]);
});

test("an edit to a file changed since it was read becomes out of date; reject works; viewers can't apply", async () => {
  const co = await goalWithEdits([{ path: "src/app.ts", content: "v2" }, { path: "notes.md", content: "n2" }], ["src/app.ts", "notes.md"]);
  await co.req("PUT", `${co.files}/files`, { path: "src/app.ts", content: "mine", baseRevision: 1 });
  const stale = await co.req("POST", `${co.base}/edits/${co.edits[0].id}/apply`);
  expect(stale.statusCode).toBe(409);
  expect(stale.json().error.message).toMatch(/changed after/);
  expect((await co.req("GET", `${co.files}/files?path=src/app.ts`)).json().content).toBe("mine");
  const viewer = await signUp(app);
  const vid = (await client(app, viewer.cookie)("GET", "/api/me")).json().user.id;
  await prisma.membership.create({ data: { workspaceId: co.id, userId: vid, role: "viewer" } });
  expect((await client(app, viewer.cookie)("POST", `${co.base}/edits/${co.edits[1].id}/apply`)).statusCode).toBe(403);
  expect((await co.req("POST", `${co.base}/edits/${co.edits[1].id}/reject`)).statusCode).toBe(200);
  const statuses = (await co.req("GET", co.base)).json().goal.edits.map((e: { status: string }) => e.status);
  expect(statuses).toEqual(["stale", "rejected"]);
});

test("applying after the project was deleted explains why", async () => {
  const co = await goalWithEdits([{ path: "docs/new.md", content: "# New" }], []);
  await co.req("DELETE", co.files);
  const res = await co.req("POST", `${co.base}/edits/${co.edits[0].id}/apply`);
  expect(res.statusCode).toBe(409);
  expect(res.json().error.message).toBe("The project was deleted, so this change can't be applied.");
});
