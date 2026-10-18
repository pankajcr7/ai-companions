import { expect, test } from "@playwright/test";
import { connectFakeLLM, newCompany } from "./setup";

test("the sidebar's Mobile App starts an app design and lists it", async ({ page }) => {
  const c = await newCompany(page, { prefix: "MobilePage", company: "Trail Club", template: /Just the head agent/ });
  await connectFakeLLM(page, c.id);
  await page.getByRole("link", { name: "Mobile App" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${c.slug}/mobile$`));
  await expect(page.getByRole("heading", { name: "Mobile App" })).toBeVisible();
  await expect(page.getByText("Your app designs will appear here.")).toBeVisible();
  await page.getByRole("button", { name: "Hiking trails" }).click();
  await expect(page.getByLabel("Describe your app, or paste your spec")).toHaveValue("A hiking trails app: saved trails, a trail map and a trip log");
  await page.getByRole("button", { name: "Design it" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${c.slug}/mobile/[^/]+$`));
  await expect(page.getByRole("heading", { name: "A hiking trails app: saved trails, a trail map and a trip log" })).toBeVisible();
  await page.getByRole("link", { name: "Mobile App" }).click();
  await expect(page.getByRole("link", { name: /A hiking trails app/ })).toBeVisible();
});
