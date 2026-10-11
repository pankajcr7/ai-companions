import sharp from "sharp";
import { afterAll, expect, test, vi } from "vitest";
import { cleanupAttachments } from "../src/attachments/service.js";
import { prisma } from "../src/db.js";
import { putBlob } from "../src/files/store.js";
import { createGoal } from "../src/goals/create.js";
import { makeApp } from "./helpers.js";
import { company, fakeLLM, fence, waitFor } from "./goal-helpers.js";

vi.setConfig({ testTimeout: 240_000 });
const PNG = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#c96" } }).png().toBuffer();
const llm = await fakeLLM();
const app = await makeApp();
afterAll(async () => {
  await llm.close();
  await app.close();
});
const isPlan = (s: string) => s.includes("Turn the owner's goal into a plan");

test("the daily cleanup removes unlinked uploads but keeps images that belong to a task", async () => {
  const co = await company(app, llm);
  llm.setScript((s) => (isPlan(s) ? fence({ tasks: [{ agentId: co.others[0].id, title: "t", instructions: "i", deliverable: "d", criteria: ["c"], dependsOn: [] }] }) : "ok"));
  const me = (await co.req("GET", "/api/me")).json().user.id as string;
  const { id: gid } = await createGoal({ workspaceId: co.id, userId: me, text: "Plan" });
  const goal = await waitFor(async () => (await co.req("GET", `/api/workspaces/${co.id}/goals/${gid}`)).json().goal, (g) => g.status === "awaiting_approval");
  const old = new Date(Date.now() - 25 * 3600_000);
  const blobHash = await putBlob(PNG);
  const row = { workspaceId: co.id, userId: me, mime: "image/png", kind: "image", size: PNG.length, blobHash, createdAt: old };
  const loose = await prisma.attachment.create({ data: { ...row, name: "loose.png" } });
  const kept = await prisma.attachment.create({ data: { ...row, name: "kept.png", taskId: goal.tasks[0].id } });
  await cleanupAttachments();
  expect(await prisma.attachment.findUnique({ where: { id: loose.id } })).toBeNull();
  expect(await prisma.attachment.findUnique({ where: { id: kept.id } })).not.toBeNull();
});
