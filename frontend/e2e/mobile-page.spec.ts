import { expect, test } from "@playwright/test";
import { connectFakeLLM, newCompany } from "./setup";

test("the sidebar's Mobile App starts an app design and lists it", async ({ page }) => {
  const c = await newCompany(page, { prefix: "MobilePage", company: "Hike Studio", template: /Just the head agent/ });
  await connectFakeLLM(page, c.id);
  await page.getByRole("link", { name: "Mobile App", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${c.slug}/mobile$`));
  await expect(page.getByRole("heading", { name: "Mobile App" })).toBeVisible();
  await expect(page.getByText("Your app designs will appear here.")).toBeVisible();
  await page.getByRole("button", { name: "Hiking trails" }).click();
  await expect(page.getByLabel("Describe your app, or paste your spec")).toHaveValue("A hiking trails app: saved trails, a trail map and a trip log");
  await page.getByRole("button", { name: "Design it" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${c.slug}/mobile/[^/]+$`));
  // App names are cut at 60 characters (spec 18), and this one is 61.
  await expect(page.getByRole("heading", { level: 1, name: /^A hiking trails app: saved trails, a trail map and a trip/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await page.getByRole("link", { name: "Mobile App", exact: true }).click();
  await expect(page.getByRole("link", { name: /A hiking trails app/ })).toBeVisible();
});

const headers = { origin: "http://localhost:3100" };
const screen = (title: string) => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title} screen</h1></body></html>`;

test("an app page shows the plan, its phone screens, and Ask for changes makes a follow-up", async ({ page }) => {
  const c = await newCompany(page, { prefix: "MobileApp", company: "Quiz Studio", template: /Just the head agent/ });
  await connectFakeLLM(page, c.id);
  const pid = (await (await page.request.post(`/api/workspaces/${c.id}/projects`, { headers, data: { name: "Quiz app" } })).json()).id as string;
  await page.request.put(`/api/workspaces/${c.id}/projects/${pid}/files`, { headers, data: { path: "screens/01-home.html", content: screen("Home"), baseRevision: 0 } });
  const gid = (await (await page.request.post(`/api/workspaces/${c.id}/goals`, { headers, data: { text: "Design a mobile app: A quiz app", projectId: pid } })).json()).id as string;
  await page.goto(`/w/${c.slug}/mobile/${gid}`);
  await expect(page.getByRole("heading", { name: "A quiz app" })).toBeVisible();
  await expect(page.getByRole("figure")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  // The page refreshes while the goal is active: a changed screen shows without reloading.
  expect((await page.request.put(`/api/workspaces/${c.id}/projects/${pid}/files`, { headers, data: { path: "screens/01-home.html", content: screen("Home v2"), baseRevision: 1 } })).ok()).toBe(true);
  await expect(page.frameLocator('iframe[title="Home screen"]').getByRole("heading", { name: "Home v2 screen" })).toBeVisible({ timeout: 20_000 });
  await page.request.post(`/api/workspaces/${c.id}/goals/${gid}/cancel`, { headers });
  await page.getByLabel("What should change?").fill("Bigger title on the Home screen");
  await page.getByRole("button", { name: "Send changes" }).click();
  await expect.poll(async () => {
    const goals = (await (await page.request.get(`/api/workspaces/${c.id}/goals`)).json()).goals as { text: string; parentGoalId: string | null }[];
    return goals.find((g) => g.parentGoalId === gid)?.text ?? "";
  }).toBe("Mobile app design changes: Bigger title on the Home screen");
});

test("a single file's Preview opens that file, not the phone screens", async ({ page }) => {
  test.setTimeout(240_000);
  const c = await newCompany(page, { prefix: "MobileFiles", company: "Bake Studio", template: /Just the head agent/ });
  await connectFakeLLM(page, c.id, "all");
  const gid = (await (await page.request.post(`/api/workspaces/${c.id}/goals`, { headers, data: { text: "Design a mobile app: A bakery app", newProject: true } })).json()).id as string;
  const goal = async () => (await (await page.request.get(`/api/workspaces/${c.id}/goals/${gid}`)).json()).goal as { status: string; projectId: string | null };
  await expect.poll(async () => (await goal()).status, { timeout: 60_000 }).toBe("awaiting_approval");
  expect((await page.request.post(`/api/workspaces/${c.id}/goals/${gid}/start`, { headers })).ok()).toBe(true);
  await expect.poll(async () => (await goal()).status, { timeout: 150_000 }).toBe("done");
  const pid = (await goal()).projectId!;
  expect((await page.request.put(`/api/workspaces/${c.id}/projects/${pid}/files`, { headers, data: { path: "screens/01-home.html", content: screen("Home"), baseRevision: 0 } })).ok()).toBe(true);
  await page.goto(`/w/${c.slug}/mobile/${gid}`);
  const files = page.getByRole("region", { name: "Files created" });
  await files.getByText(/Files created ·/).click();
  await files.getByRole("button", { name: "Preview style.css" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Preview file")).toHaveValue("style.css");
  await expect(dialog.getByRole("figure")).toHaveCount(0);
});

test("Design it shows the real reason when Nova has no model, not 'team busy'", async ({ page }) => {
  const c = await newCompany(page, { prefix: "MobileNoModel", company: "Plain Studio", template: /Just the head agent/ });
  await page.goto(`/w/${c.slug}/mobile`);
  await page.getByLabel("Describe your app, or paste your spec").fill("A notes app");
  await page.getByRole("button", { name: "Design it" }).click();
  const alert = page.getByRole("alert").filter({ hasText: /model|Nova/ });
  await expect(alert).toBeVisible();
  await expect(page.getByText("Your team is busy with another goal.")).toHaveCount(0);
});

test("applying a suggested change after the goal is done reloads the app's files", async ({ page }) => {
  test.setTimeout(240_000);
  const c = await newCompany(page, { prefix: "MobileApply", company: "Math Studio", template: /Just the head agent/ });
  await connectFakeLLM(page, c.id, "all");
  const pid = (await (await page.request.post(`/api/workspaces/${c.id}/projects`, { headers, data: { name: "Math app" } })).json()).id as string;
  for (const [path, content] of [["screens/01-home.html", screen("Home")], ["sample-app/src/lib/math.ts", "export const add = (a: number, b: number) => a + b;\n"]]) {
    expect((await page.request.put(`/api/workspaces/${c.id}/projects/${pid}/files`, { headers, data: { path, content, baseRevision: 0 } })).ok()).toBe(true);
  }
  const gid = (await (await page.request.post(`/api/workspaces/${c.id}/goals`, { headers, data: { text: "Design a mobile app: A math app", projectId: pid } })).json()).id as string;
  const status = async () => (await (await page.request.get(`/api/workspaces/${c.id}/goals/${gid}`)).json()).goal.status as string;
  await expect.poll(status, { timeout: 60_000 }).toBe("awaiting_approval");
  expect((await page.request.post(`/api/workspaces/${c.id}/goals/${gid}/start`, { headers })).ok()).toBe(true);
  await expect.poll(status, { timeout: 150_000 }).toBe("done");
  await page.goto(`/w/${c.slug}/mobile/${gid}`);
  await page.getByRole("button", { name: "Review" }).click();
  const apply = page.getByRole("button", { name: /^Apply/ }).first();
  await expect(apply).toBeVisible();
  // The goal is done, so the 5-second refresh has stopped; applying must still reload the project's files.
  const reload = page.waitForRequest((r) => r.url().endsWith(`/projects/${pid}/tree`), { timeout: 15_000 });
  await apply.click();
  await reload;
});
