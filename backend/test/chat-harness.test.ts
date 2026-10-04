import { afterAll, expect, test, vi } from "vitest";
import { makeApp } from "./helpers.js";
import { company, fakeLLM, fence } from "./goal-helpers.js";

vi.setConfig({ testTimeout: 240_000 });
const llm = await fakeLLM();
const app = await makeApp();
afterAll(async () => {
  await llm.close();
  await app.close();
});
const tool = (name: string, args: object) => fence({ tool: name, args });
const isNova = (s: string) => s.includes("When the owner asks for work to be done") && !s.includes("Turn the owner's goal into a plan");

async function setup() {
  const co = await company(app, llm);
  const pid = (await co.req("POST", `/api/workspaces/${co.id}/projects`, { name: "Shop" })).json().id as string;
  await co.req("PUT", `/api/workspaces/${co.id}/projects/${pid}/files`, { path: "README.md", content: "# Shop\nSells bread.\n", baseRevision: 0 });
  const cid = (await co.req("POST", `/api/workspaces/${co.id}/conversations`)).json().id as string;
  const base = `/api/workspaces/${co.id}/conversations/${cid}`;
  return { co, pid, base };
}

test("a chat reply reads a file: tool events stream, only the answer is saved, activity is kept", async () => {
  const { co, pid, base } = await setup();
  llm.setScript((s, u) => (isNova(s) ? (u.startsWith("TOOL RESULT") ? (u.includes("Sells bread.") ? "Your app sells bread." : "no") : tool("read_file", { path: "README.md" })) : "ok"));
  const res = await co.req("POST", `${base}/messages`, { message: "What does my app do?", project: { kind: "existing", id: pid } });
  expect(res.body).toContain('event: tool\ndata: {"name":"read_file","label":"README.md"}');
  const msgs = (await co.req("GET", base)).json().messages;
  expect(msgs.at(-1)).toMatchObject({ role: "assistant", content: "Your app sells bread.", toolUses: [{ name: "read_file", label: "README.md", ok: true }], edits: [] });
});

test("a chat write becomes a suggested change; Apply saves it; a changed file makes it stale; Skip declines", async () => {
  const { co, pid, base } = await setup();
  let n = 0;
  llm.setScript((s) => {
    if (!isNova(s)) return "ok";
    n++;
    if (n % 2 === 1) return tool("write_file", { path: "README.md", content: `# Shop v${n}\n`, note: "Rename" });
    return "I suggested a change.";
  });
  const send = () => co.req("POST", `${base}/messages`, { message: "Rename the shop", project: { kind: "existing", id: pid } });
  await send();
  await send();
  await send();
  const edits = (await co.req("GET", base)).json().messages.filter((m: { role: string }) => m.role === "assistant").map((m: { edits: { id: string; status: string }[] }) => m.edits[0]);
  expect(edits.map((e: { status: string }) => e.status)).toEqual(["pending", "pending", "pending"]);
  const ws = `/api/workspaces/${co.id}/chat-edits`;
  expect((await co.req("GET", `${ws}/${edits[0].id}`)).json().edit).toMatchObject({ path: "README.md", content: "# Shop v1\n", current: "# Shop\nSells bread.\n" });
  expect((await co.req("POST", `${ws}/${edits[0].id}/apply`)).json()).toEqual({ revision: 2 });
  expect((await co.req("POST", `${ws}/${edits[0].id}/apply`)).statusCode).toBe(409);
  const stale = await co.req("POST", `${ws}/${edits[1].id}/apply`);
  expect(stale.statusCode).toBe(409);
  expect(stale.json().error.code).toBe("stale");
  expect((await co.req("POST", `${ws}/${edits[2].id}/skip`)).json()).toEqual({ ok: true });
  const after = (await co.req("GET", base)).json().messages.filter((m: { role: string }) => m.role === "assistant").map((m: { edits: { status: string }[] }) => m.edits[0].status);
  expect(after).toEqual(["applied", "stale", "rejected"]);
});

test("without a project only web tools are offered; one-to-one chats get web tools", async () => {
  const { co, base } = await setup();
  const seen: string[] = [];
  llm.setScript((s) => (seen.push(s), "Hi."));
  await co.req("POST", `${base}/messages`, { message: "Hello", project: { kind: "none" } });
  await co.req("POST", `/api/workspaces/${co.id}/agents/${co.others[0].id}/chat`, { message: "Hello" });
  for (const s of seen) {
    expect(s).toContain("- open_url:");
    expect(s).not.toContain("- read_file:");
    expect(s).not.toContain("- web_search:");
  }
});

test("another user can't see or apply someone's chat suggestion", async () => {
  const { co, pid, base } = await setup();
  let n = 0;
  llm.setScript((s) => (isNova(s) ? (++n === 1 ? tool("write_file", { path: "x.md", content: "x" }) : "Done.") : "ok"));
  await co.req("POST", `${base}/messages`, { message: "Add x", project: { kind: "existing", id: pid } });
  const eid = (await co.req("GET", base)).json().messages.at(-1).edits[0].id as string;
  const other = await company(app, llm);
  expect((await other.req("POST", `/api/workspaces/${co.id}/chat-edits/${eid}/apply`)).statusCode).toBeGreaterThanOrEqual(403);
  expect((await other.req("POST", `/api/workspaces/${other.id}/chat-edits/${eid}/apply`)).statusCode).toBe(404);
});
