import { afterAll, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { makeApp, ORIGIN } from "./helpers.js";
import { company, fakeLLM, fence, userOf } from "./goal-helpers.js";
import { multipart } from "./upload-helpers.js";

const llm = await fakeLLM();
const app = await makeApp();
afterAll(async () => {
  await llm.close();
  await app.close();
});

async function withProject(files: [string, string][]) {
  const co = await company(app, llm, "head-only");
  const body = multipart({ name: "Site", source: "folder" }, files.map(([p, c]) => [p, p.split("/").pop()!, c]));
  const pid = (await app.inject({ method: "POST", url: `/api/workspaces/${co.id}/projects/upload`, payload: body.payload, headers: { ...body.headers, cookie: co.cookie, origin: ORIGIN } })).json().projectId as string;
  return { ...co, pid, base: `/api/workspaces/${co.id}/projects/${pid}` };
}

test("Nova reads key files and writes a reusable summary that goes stale on change", async () => {
  const { req, id, base, pid } = await withProject([["README.md", "# Crumb bakery app"], ["src/app.ts", "export {}"]]);
  llm.setScript((system) => (system.includes("Pick the files you need to read") ? fence({ read: ["README.md", "missing.ts"] }) : "Crumb is a bakery ordering app."));
  const before = llm.requests.length;
  const res = await req("POST", `${base}/summarize`);
  expect(res.statusCode).toBe(200);
  expect(res.json().summary).toMatchObject({ text: "Crumb is a bakery ordering app.", stale: false });
  expect(userOf(llm.requests[before + 1])).toContain("# Crumb bakery app");
  expect((await req("GET", `${base}/tree`)).json().summary).toMatchObject({ text: "Crumb is a bakery ordering app.", stale: false });
  await req("PUT", `${base}/files`, { path: "src/app.ts", content: "export const x = 1;", baseRevision: 1 });
  expect((await req("GET", `${base}/tree`)).json().summary.stale).toBe(true);
  const steps = await prisma.goalStep.findMany({ where: { workspaceId: id, phase: "project_summary" } });
  expect(steps.length).toBe(2);
  expect((await prisma.project.findUniqueOrThrow({ where: { id: pid } })).summaryRevisionKey).toBeTruthy();
});

test("summaries are capped and need Nova's model", async () => {
  const { req, id, base, nova } = await withProject([["a.md", "a"]]);
  llm.setScript((system) => (system.includes("Pick the files you need to read") ? fence({ read: ["a.md"] }) : "y".repeat(7000)));
  expect((await req("POST", `${base}/summarize`)).json().summary.text.length).toBe(6000);
  await req("PATCH", `/api/workspaces/${id}/agents/${nova.id}`, { connectionId: null, model: null });
  const res = await req("POST", `${base}/summarize`);
  expect(res.statusCode).toBe(409);
  expect(res.json().error.message).toMatch(/Nova has no AI model/);
});

test("saving through saveText keeps the PUT /files behavior", async () => {
  const { req, base } = await withProject([["a.md", "a"]]);
  expect((await req("PUT", `${base}/files`, { path: "a.md", content: "b", baseRevision: 1 })).json()).toEqual({ revision: 2 });
  expect((await req("PUT", `${base}/files`, { path: "a.md", content: "c", baseRevision: 1 })).statusCode).toBe(409);
  expect((await req("PUT", `${base}/files`, { path: "n/new.md", content: "n", baseRevision: 0 })).json()).toEqual({ revision: 1 });
});
