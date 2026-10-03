import { afterAll, expect, test, vi } from "vitest";
import { makeApp } from "./helpers.js";
import { company, fakeLLM, fence, systemOf, waitFor } from "./goal-helpers.js";

// Each test builds whole companies at remote-database latency.
vi.setConfig({ testTimeout: 240_000 });
const llm = await fakeLLM();
const app = await makeApp();
afterAll(async () => {
  await llm.close();
  await app.close();
});

const SUGGEST = "When the owner asks for work to be done";
const lastChat = () => llm.requests.filter((q) => q.path === "/v1/chat/completions").at(-1)!;

test("Nova's one-to-one chat knows the team and can hand work to it; other companions don't get that rule", async () => {
  const co = await company(app, llm);
  const [first, second] = co.others;
  await co.req("PATCH", `/api/workspaces/${co.id}/agents/${second.id}`, { connectionId: null, model: null });
  const snap = (await co.req("GET", `/api/workspaces/${co.id}`)).json();
  const role = (id: string) => snap.agents.find((a: { id: string }) => a.id === id).role as string;
  llm.setScript(() => "ok");

  await co.req("POST", `/api/workspaces/${co.id}/agents/${co.nova.id}/chat`, { message: "Ask marketing to promote the app" });
  const nova = systemOf(lastChat());
  expect(nova).toContain("You are Nova, the Head agent");
  expect(nova).toContain("TEAM:");
  expect(nova).toContain(`| ${first.name} | ${role(first.id)} |`);
  expect(nova).toMatch(new RegExp(`\\| ${second.name} \\|[^\\n]*no AI model yet`));
  expect(nova).toContain(SUGGEST);

  await co.req("POST", `/api/workspaces/${co.id}/agents/${first.id}/chat`, { message: "Hi" });
  const other = systemOf(lastChat());
  expect(other).toContain(`You are ${first.name}`);
  expect(other).not.toContain(SUGGEST);
  expect(other).not.toContain("TEAM:");
});

test("goal chat lists the team and can hand new work to it", async () => {
  const co = await company(app, llm);
  llm.setScript((s) =>
    s.includes("Turn the owner's goal into a plan")
      ? fence({ tasks: [{ agentId: co.others[0].id, title: "Draft", instructions: "Write", deliverable: "Text", criteria: ["Short"], dependsOn: [] }] })
      : s.includes("Review each task result")
        ? fence({ summary: "Done.", verdicts: [] })
        : "ok",
  );
  const gid = (await co.req("POST", `/api/workspaces/${co.id}/goals`, { text: "Write copy" })).json().id as string;
  const base = `/api/workspaces/${co.id}/goals/${gid}`;
  const get = async () => (await co.req("GET", base)).json().goal;
  await waitFor(get, (g) => g.status === "awaiting_approval");
  await co.req("POST", `${base}/start`);
  await waitFor(get, (g) => g.status === "done");
  await co.req("POST", `${base}/chat`, { message: "Now ask marketing to promote it" });
  const sent = systemOf(lastChat());
  expect(sent).toContain("TEAM:");
  expect(sent).toContain(`| ${co.others[0].name} |`);
  expect(sent).toContain(SUGGEST);
});
