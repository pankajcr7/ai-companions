import { expect, type Page, test } from "@playwright/test";
import { newCompany } from "./setup";

const headers = { origin: "http://localhost:3100" };
const screen = (title: string) => `<!doctype html><html><head><title>${title}</title><meta name="viewport" content="width=390, initial-scale=1"></head><body><h1>${title} screen</h1></body></html>`;

async function project(page: Page, id: string, name: string, files: [string, string][]) {
  const res = await page.request.post(`/api/workspaces/${id}/projects`, { headers, data: { name } });
  expect(res.ok()).toBe(true);
  const pid = (await res.json()).id as string;
  for (const [path, content] of files) expect((await page.request.put(`/api/workspaces/${id}/projects/${pid}/files`, { headers, data: { path, content, baseRevision: 0 } })).ok()).toBe(true);
  return pid;
}

test("a project with app screens shows them in phone frames; a plain site doesn't offer them", async ({ page }) => {
  const c = await newCompany(page, { prefix: "Mobile", company: "Trail Club", template: /Just the head agent/ });
  const app = await project(page, c.id, "Trail app", [["screens/02-profile.html", screen("Profile")], ["screens/01-home.html", screen("Home")]]);
  const site = await project(page, c.id, "Plain site", [["index.html", "<h1>Hi</h1>"]]);

  await page.goto(`/w/${c.slug}/projects/${site}`);
  await expect(page.getByRole("heading", { name: "Plain site" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Phone screens" })).toHaveCount(0);

  await page.goto(`/w/${c.slug}/projects/${app}`);
  await page.getByRole("button", { name: "Phone screens" }).click();
  const gallery = page.getByRole("dialog", { name: "Phone screens" });
  await expect(gallery.getByRole("figure")).toHaveCount(2);
  await expect(gallery.getByRole("figure").nth(0)).toContainText("Home");
  await expect(gallery.getByRole("figure").nth(1)).toContainText("Profile");
  await expect(gallery.locator('iframe[title="Home screen"]')).toHaveAttribute("loading", "lazy");
  await expect(gallery.frameLocator('iframe[title="Home screen"]').getByRole("heading", { name: "Home screen" })).toBeVisible();
  await expect(gallery.getByRole("link", { name: "Download screens" })).toHaveAttribute("href", /download\.zip$/);
  await gallery.getByRole("button", { name: "Open Home full size" }).click();
  const full = page.getByRole("dialog", { name: "Home" });
  await expect(full.locator('iframe[title="Home screen, full size"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(full).toHaveCount(0);
  await expect(gallery).toBeVisible();
});

test("in chat, the preview opens on the screens and Ask for changes fills the message", async ({ page }) => {
  const c = await newCompany(page, { prefix: "MobileChat", company: "Quiz Club", template: /Just the head agent/ });
  await project(page, c.id, "Quiz app", [["index.html", "<h1>Site</h1>"], ["screens/01-home.html", screen("Home")]]);
  await page.goto(`/w/${c.slug}`);
  await page.getByRole("button", { name: "Preview" }).click();
  const panel = page.getByRole("region", { name: "Work preview" });
  await expect(panel.getByRole("figure")).toHaveCount(1);
  await expect(panel.getByLabel("Preview file")).toContainText("index.html");
  await panel.getByRole("button", { name: "Ask for changes to Home" }).click();
  await expect(page.getByLabel("Message Nova")).toHaveValue(/^Please update screens\/01-home\.html in Quiz app: /);
});
