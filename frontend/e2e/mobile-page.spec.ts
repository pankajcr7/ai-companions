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
  await page.request.post(`/api/workspaces/${c.id}/goals/${gid}/cancel`, { headers });
  await page.getByLabel("What should change?").fill("Bigger title on the Home screen");
  await page.getByRole("button", { name: "Send changes" }).click();
  await expect.poll(async () => {
    const goals = (await (await page.request.get(`/api/workspaces/${c.id}/goals`)).json()).goals as { text: string; parentGoalId: string | null }[];
    return goals.find((g) => g.parentGoalId === gid)?.text ?? "";
  }).toBe("Mobile app design changes: Bigger title on the Home screen");
});
