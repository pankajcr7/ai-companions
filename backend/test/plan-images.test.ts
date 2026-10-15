import { afterAll, expect, test, vi } from "vitest";
import { encryptSecret } from "../src/crypto.js";
import { prisma } from "../src/db.js";
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

const isPlan = (s: string) => s.includes("Turn the owner's goal into a plan");

/** Plans a goal and returns the planning instructions Nova was given. */
async function planSystem(co: Awaited<ReturnType<typeof company>>) {
  llm.setScript((s) => (isPlan(s) ? fence({ tasks: [{ agentId: co.others[0].id, title: "Make the post", instructions: "i", deliverable: "d", criteria: ["c"], dependsOn: [] }] }) : "ok"));
  const gid = (await co.req("POST", `/api/workspaces/${co.id}/goals`, { text: "Make an Instagram post for our product" })).json().id as string;
  await waitFor(async () => (await co.req("GET", `/api/workspaces/${co.id}/goals/${gid}`)).json().goal, (g) => g.status === "awaiting_approval");
  return systemOf(llm.requests.filter((q) => q.path === "/v1/chat/completions" && isPlan(systemOf(q))).at(-1)!);
}

test("Nova plans images as generate_image work only when the company can make images", async () => {
  const without = await company(app, llm);
  expect(await planSystem(without)).not.toContain("The team can make images with generate_image");

  const withKey = await company(app, llm);
  const owner = await prisma.membership.findFirstOrThrow({ where: { workspaceId: withKey.id, role: "owner" } });
  await prisma.imageKey.create({ data: { workspaceId: withKey.id, provider: "cloudflare", secret: encryptSecret(JSON.stringify({ accountId: "a", apiToken: "t" })), hint: "t…", createdById: owner.userId } });
  expect(await planSystem(withKey)).toContain("The team can make images with generate_image");
});
