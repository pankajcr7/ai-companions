import { expect, type Page } from "@playwright/test";

const headers = { origin: "http://localhost:3100" };

/** Signs up a new owner through the UI and creates their company. */
export async function newCompany(page: Page, o: { prefix: string; company: string; template: RegExp }) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(`${o.prefix} Owner`);
  await page.getByLabel("Email").fill(`${o.prefix.toLowerCase()}-${Date.now()}@test.dev`);
  await page.getByLabel("Password").fill("correct-horse-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Company name").fill(o.company);
  await page.getByRole("radio", { name: o.template }).check();
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+$/);
  const slug = new URL(page.url()).pathname.split("/")[2];
  const me = await (await page.request.get("/api/me")).json();
  return { id: me.workspaces.find((w: { slug: string }) => w.slug === slug).id as string, slug };
}

/** Connects the fake model server and gives the head agent (or every AI companion) its model. */
export async function connectFakeLLM(page: Page, id: string, who: "head" | "all" = "head") {
  const res = await page.request.post(`/api/workspaces/${id}/connections`, { headers, data: { kind: "custom", label: "Fake LLM", baseUrl: "http://127.0.0.1:4199/v1" } });
  expect(res.status()).toBe(201);
  const connectionId = (await res.json()).id as string;
  const snap = await (await page.request.get(`/api/workspaces/${id}`)).json();
  for (const a of snap.agents.filter((x: { kind: string; isHead: boolean }) => x.kind === "ai" && (who === "all" || x.isHead))) {
    const patch = await page.request.patch(`/api/workspaces/${id}/agents/${a.id}`, { headers, data: { connectionId, model: "fake-model" } });
    expect(patch.ok()).toBe(true);
  }
  await page.reload();
  return connectionId;
}

/** Starts planning a goal and opens its full page. */
export async function startGoal(page: Page, c: { id: string; slug: string }, body: { text: string; projectId?: string; newProject?: boolean }) {
  const res = await page.request.post(`/api/workspaces/${c.id}/goals`, { headers, data: body });
  expect(res.status()).toBe(201);
  const gid = (await res.json()).id as string;
  await page.goto(`/w/${c.slug}/goals/${gid}`);
  return gid;
}
